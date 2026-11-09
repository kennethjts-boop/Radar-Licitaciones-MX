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
  documentUrl: string;
  documentName: string | null;
  sourceKind: "convocatoria_secogem" | "detalle_bases_anexo" | "requerimientos_economicos";
}

interface EconomicGroup {
  data_registros?: Array<{ descripcion_detallada?: string; monto_minimo?: number | null; monto_maximo?: number | null }>;
}

/**
 * Presupuesto del procedimiento a partir de los «requerimientos económicos»
 * que ComprasMX publica por partida: suma de `monto_maximo` (tope del contrato).
 * Devuelve null si ninguna partida trae monto o si la lista está incompleta.
 */
export function summarizeEconomicRequirements(
  payload: unknown,
): { amount: number; partidas: number; excerpt: string } | null {
  const data = (payload as {
    data?: Array<{ registros?: EconomicGroup[]; paginacion?: Array<{ total_registros?: number; total_paginas?: number }> }>;
  })?.data?.[0];
  const groups = data?.registros;
  if (!Array.isArray(groups) || groups.length === 0) return null;
  const rows = groups.flatMap((group) => group.data_registros ?? []);
  const priced = rows.filter((row) => typeof row.monto_maximo === "number" && row.monto_maximo > 0);
  if (priced.length === 0) return null;
  const reported = data?.paginacion?.[0];
  // Si el portal reporta más páginas/registros de los leídos, no se afirma un total parcial.
  if ((reported?.total_paginas ?? 1) > 1 ||
      (typeof reported?.total_registros === "number" && reported.total_registros > rows.length)) return null;
  const amount = Math.round(priced.reduce((sum, row) => sum + (row.monto_maximo as number), 0) * 100) / 100;
  const detail = priced.slice(0, 8).map((row) =>
    `${(row.descripcion_detallada ?? "partida").slice(0, 40)}: $${(row.monto_maximo as number).toLocaleString("es-MX")}`);
  return { amount, partidas: priced.length,
    excerpt: `Suma de monto máximo de ${priced.length} partida(s): ${detail.join("; ")}`.slice(0, 600) };
}

/** Abre el detalle del expediente con el navegador del colector y captura los requerimientos económicos. */
async function fetchEconomicRequirements(detailUrl: string): Promise<unknown[]> {
  return BrowserManager.withContext(async (page) => {
    const payloads: unknown[] = [];
    page.on("response", async (response) => {
      if (/\/reqeconomicos\?/.test(response.url()) && response.status() === 200) {
        try { payloads.push(await response.json()); } catch { /* respuesta no JSON */ }
      }
    });
    await page.goto(detailUrl, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(5_000);
    return payloads;
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
    // 1) Dato estructurado del portal: requerimientos económicos por partida.
    try {
      for (const payload of await fetchEconomicRequirements(input.sourceUrl)) {
        const summary = summarizeEconomicRequirements(payload);
        if (summary) {
          return {
            amount: summary.amount, page: null,
            label: `Requerimientos económicos del expediente (${summary.partidas} partidas, monto máximo)`,
            excerpt: summary.excerpt, documentUrl: input.sourceUrl,
            documentName: "Detalle del expediente › Requerimientos económicos", sourceKind: "requerimientos_economicos",
          };
        }
      }
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
        best = { ...finding, documentUrl: documents[i].fileUrl, documentName: documents[i].fileName,
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
    procurement_id: procurementId, amount: budget.amount, currency: "MXN",
    document_url: budget.documentUrl, document_name: budget.documentName, page_number: budget.page,
    label: budget.label, excerpt: budget.excerpt, source_kind: budget.sourceKind, confirmed_at: nowISO(),
  }, { onConflict: "procurement_id" });
  if (error) throw new Error(`Presupuesto oficial: ${error.message}`);
  const { error: updateError } = await db.from("procurements").update({ amount: budget.amount, currency: "MXN" })
    .eq("id", procurementId).is("amount", null);
  if (updateError) throw new Error(`Monto del expediente: ${updateError.message}`);
  return true;
}

export async function resolveOfficialBudget(input: ResolveInput): Promise<ResolvedBudget | null> {
  const budget = await findOfficialBudget(input);
  if (budget) await persistOfficialBudget(input.procurementId, budget);
  return budget;
}
