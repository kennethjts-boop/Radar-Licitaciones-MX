/**
 * Confirma el presupuesto oficial de expedientes prioritarios con «monto por
 * verificar» leyendo sus documentos oficiales (convocatoria SECOGEM, o detalle,
 * bases y anexos de ComprasMX vía el colector de detalle existente).
 *
 * Guarda el enlace y la página donde consta el monto en
 * `procurement_official_budget` y, sólo si `procurements.amount` está vacío,
 * lo completa. Nunca sobrescribe un monto ya confirmado.
 */
import { getSupabaseClient } from "../../storage/client";
import { normalizeText } from "../../core/text";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { collectComprasMxDetail, type DocumentLink } from "../../collectors/comprasmx-detail/index";
import { downloadDocument, downloadDocuments } from "../../services/document-downloader";
import { extractPdfPages } from "../../utils/pdf.util";
import { parseDocx } from "../../parsers/docx-parser";
import { parseXlsx } from "../../parsers/xlsx-parser";
import { extractOfficialBudget, type OfficialBudgetFinding } from "../../services/official-budget-extractor";
import { BrowserManager } from "../../collectors/comprasmx/browser.manager";

const log = createModuleLogger("priority-budget");

export interface ResolveInput {
  procurementId: string;
  source: string;
  sourceUrl: string;
  procedureNumber: string | null;
  expedienteId: string | null;
}

export interface ResolvedBudget extends Omit<OfficialBudgetFinding, "page"> {
  /** Página del documento donde consta; null cuando el dato es estructurado (portal) o el formato no pagina. */
  page: number | null;
  /** Moneda verificada en la fuente; sin verificación no se confirma ningún monto. */
  currency: "MXN";
  documentUrl: string;
  documentName: string | null;
  sourceKind: "convocatoria_secogem" | "detalle_bases_anexo" | "requerimientos_economicos";
}

interface EconomicRow {
  grupo?: string;
  descripcion_detallada?: string;
  monto_minimo?: number | null;
  monto_maximo?: number | null;
}
interface EconomicGroup { grupo?: string; data_registros?: EconomicRow[] }
export interface DetailRecord {
  descripcion_moneda?: string | null;
  contrato_abierto?: number | null;
  tipo_contrato_abierto?: string | null;
  req_economicos?: unknown[] | null;
}

const PESO = /^(?:peso mexicano|pesos mexicanos|mxn|moneda nacional|peso)$/;

/**
 * Presupuesto del procedimiento a partir de los «requerimientos económicos»
 * que ComprasMX publica por partida (suma de `monto_maximo`, el tope del contrato).
 * Sólo se confirma si hay evidencia de que:
 *  - la moneda del expediente es peso mexicano (campo `descripcion_moneda` del detalle);
 *  - las partidas son independientes y acumulables (todos los grupos son «PARTIDA SOLA»);
 *  - la lista está completa: el portal reporta tantos registros como se leyeron, el detalle del
 *    expediente lista las mismas partidas, la numeración «PARTIDA n» es contigua y todas traen
 *    monto máximo (>= mínimo).
 * Si algo falta devuelve `null` y el expediente sigue como «monto por verificar».
 */
export function summarizeEconomicRequirements(
  payload: unknown,
  detail: DetailRecord | null,
): { amount: number; partidas: number; excerpt: string; currency: "MXN" } | null {
  const data = (payload as {
    data?: Array<{ registros?: EconomicGroup[]; paginacion?: Array<{ total_registros?: number; total_paginas?: number }> }>;
  })?.data?.[0];
  const groups = data?.registros;
  if (!Array.isArray(groups) || groups.length === 0 || !detail) return null;

  const currency = normalizeText(String(detail.descripcion_moneda ?? ""));
  if (!PESO.test(currency)) return null;

  const additive = groups.every((group) => normalizeText(String(group.grupo ?? "")) === "partida sola");
  if (!additive) return null;

  const rows = groups.flatMap((group) => group.data_registros ?? []);
  if (rows.length === 0) return null;
  const reported = data?.paginacion?.[0];
  if ((reported?.total_paginas ?? 1) > 1 ||
      (typeof reported?.total_registros === "number" && reported.total_registros !== rows.length)) return null;
  if (Array.isArray(detail.req_economicos) && detail.req_economicos.length !== rows.length) return null;

  const priced = rows.filter((row) => typeof row.monto_maximo === "number" && row.monto_maximo > 0 &&
    (typeof row.monto_minimo !== "number" || row.monto_minimo <= row.monto_maximo));
  if (priced.length !== rows.length) return null; // alguna partida sin monto máximo válido

  const numbers = rows.map((row) => Number(/partida\s+(\d+)/i.exec(row.descripcion_detallada ?? "")?.[1] ?? NaN));
  if (numbers.every(Number.isFinite)) {
    const sorted = [...numbers].sort((a, b) => a - b);
    if (!sorted.every((n, i) => n === i + 1)) return null; // numeración con huecos o repetida
  }

  const amount = Math.round(priced.reduce((sum, row) => sum + (row.monto_maximo as number), 0) * 100) / 100;
  const lines = priced.slice(0, 8).map((row) =>
    `${(row.descripcion_detallada ?? "partida").slice(0, 36)}: $${(row.monto_maximo as number).toLocaleString("es-MX")}`);
  const open = detail.contrato_abierto === 1 ? ` Contrato abierto por ${String(detail.tipo_contrato_abierto ?? "monto").toLowerCase()}.` : "";
  return {
    amount, partidas: priced.length, currency: "MXN",
    excerpt: (`Moneda: peso mexicano. Suma de monto máximo de ${priced.length} partidas independientes (PARTIDA SOLA): ` +
      `${lines.join("; ")}.${open} IVA: no consta en el portal.`).slice(0, 700),
  };
}

/** Abre el detalle del expediente con el navegador del colector y captura requerimientos económicos y registro del expediente. */
async function fetchEconomicEvidence(detailUrl: string): Promise<{ economic: unknown[]; detail: DetailRecord | null }> {
  return BrowserManager.withContext(async (page) => {
    const economic: unknown[] = [];
    let detail: DetailRecord | null = null;
    page.on("response", async (response) => {
      if (response.status() !== 200) return;
      try {
        if (/\/reqeconomicos\?/.test(response.url())) economic.push(await response.json());
        else if (/\/expedientes\/[0-9a-f]{32}\?/.test(response.url())) {
          const body = (await response.json()) as { data?: { registro?: DetailRecord[]; req_economicos?: unknown[] } };
          const record = body.data?.registro?.[0];
          if (record) detail = { ...record, req_economicos: body.data?.req_economicos ?? null };
        }
      } catch { /* respuesta no JSON */ }
    });
    await page.goto(detailUrl, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(5_000);
    return { economic, detail };
  }, { timeoutMs: 120_000 });
}

async function pagesOf(localPath: string, fileType: string): Promise<string[]> {
  if (fileType === "pdf") return extractPdfPages(localPath);
  if (fileType === "docx") return [(await parseDocx(localPath)).text];
  if (fileType === "xlsx") return [(await parseXlsx(localPath)).text];
  return [];
}

/** Lee los documentos oficiales del expediente y devuelve el presupuesto del procedimiento, si consta. */
export async function findOfficialBudget(input: ResolveInput): Promise<ResolvedBudget | null> {
  const isSecogem = input.source === "secogem_edomex";
  if (!isSecogem) {
    // 1) Dato estructurado del portal: requerimientos económicos por partida, con moneda y completitud verificadas.
    try {
      const evidence = await fetchEconomicEvidence(input.sourceUrl);
      for (const payload of evidence.economic) {
        const summary = summarizeEconomicRequirements(payload, evidence.detail);
        if (summary) {
          return {
            amount: summary.amount, currency: summary.currency, page: null,
            label: `Requerimientos económicos del expediente (${summary.partidas} partidas, monto máximo)`,
            excerpt: summary.excerpt, documentUrl: input.sourceUrl,
            documentName: "Detalle del expediente › Requerimientos económicos", sourceKind: "requerimientos_economicos",
          };
        }
      }
      log.info({ sourceUrl: input.sourceUrl, hasDetail: Boolean(evidence.detail), payloads: evidence.economic.length },
        "Requerimientos económicos sin evidencia suficiente (moneda, partidas o integridad); sigue por verificar");
    } catch (err) {
      log.warn({ err, sourceUrl: input.sourceUrl }, "Requerimientos económicos no disponibles; se intenta con documentos");
    }
  }
  const documents: DocumentLink[] = isSecogem
    ? [{ documentTitle: "Convocatoria oficial (SECOGEM)", fileName: input.sourceUrl.split("/").pop() ?? null,
        fileUrl: input.sourceUrl, fileType: "pdf", source: "SECOGEM", discoveredAt: nowISO(),
        documentHint: "convocatoria", isDownloadable: /^https:\/\//i.test(input.sourceUrl) } as DocumentLink]
    : (await collectComprasMxDetail({
        sourceUrl: input.sourceUrl, procedureNumber: input.procedureNumber,
        expedienteId: input.expedienteId, scope: "PRIORITY",
      })).documents.filter((doc) => doc.isDownloadable);
  if (documents.length === 0) return null;

  const downloads = isSecogem ? [await downloadDocument(documents[0])] : await downloadDocuments(documents.slice(0, 8));
  let best: ResolvedBudget | null = null;
  for (let i = 0; i < downloads.length; i++) {
    const download = downloads[i];
    if (!download.localPath || (download.downloadStatus !== "ok" && download.downloadStatus !== "skipped_duplicate")) continue;
    try {
      const finding = extractOfficialBudget(await pagesOf(download.localPath, download.fileType));
      if (finding && (!best || finding.amount > best.amount)) {
        best = { ...finding, currency: "MXN", documentUrl: documents[i].fileUrl, documentName: documents[i].fileName,
          sourceKind: isSecogem ? "convocatoria_secogem" : "detalle_bases_anexo" };
      }
    } catch (err) {
      log.warn({ err, fileUrl: documents[i].fileUrl }, "Documento no legible para presupuesto");
    }
  }
  return best;
}

/** Persiste la evidencia y completa `procurements.amount` si estaba vacío. Devuelve true si el monto quedó confirmado. */
export async function persistOfficialBudget(procurementId: string, budget: ResolvedBudget): Promise<boolean> {
  const db = getSupabaseClient();
  const { error } = await db.from("procurement_official_budget").upsert({
    procurement_id: procurementId, amount: budget.amount, currency: budget.currency,
    document_url: budget.documentUrl, document_name: budget.documentName, page_number: budget.page,
    label: budget.label, excerpt: budget.excerpt, source_kind: budget.sourceKind, confirmed_at: nowISO(),
  }, { onConflict: "procurement_id" });
  if (error) throw new Error(`Presupuesto oficial: ${error.message}`);
  const { error: updateError } = await db.from("procurements").update({ amount: budget.amount, currency: budget.currency })
    .eq("id", procurementId).is("amount", null);
  if (updateError) throw new Error(`Monto del expediente: ${updateError.message}`);
  return true;
}

export async function resolveOfficialBudget(input: ResolveInput): Promise<ResolvedBudget | null> {
  const budget = await findOfficialBudget(input);
  if (budget) await persistOfficialBudget(input.procurementId, budget);
  return budget;
}
