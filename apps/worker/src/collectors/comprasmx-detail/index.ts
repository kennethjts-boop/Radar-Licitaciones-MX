/**
 * COMPRASMX DETAIL COLLECTOR — Abre el expediente público y extrae DocumentLinks.
 * Usa BrowserManager.withContext (Playwright) para renderizar la SPA Angular.
 */
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { BrowserManager } from "../comprasmx/browser.manager";

const log = createModuleLogger("comprasmx-detail-collector");

const RATE_LIMIT_MS = 3_000;
const LOAD_TIMEOUT_MS = 15_000;
const CONTEXT_BUFFER_MS = 5_000;

// ── Tipos ──────────────────────────────────────────────────────────────────────

export type FileType = "pdf" | "docx" | "xlsx" | "zip" | "rar" | "other";
export type DocumentHint =
  | "convocatoria"
  | "anexo_tecnico"
  | "anexo_economico"
  | "anexo_legal"
  | "fallo"
  | "contrato"
  | "otro";

export interface DocumentLink {
  documentTitle: string;
  fileName: string | null;
  fileUrl: string;
  fileType: FileType;
  source: string;
  discoveredAt: string;
  documentHint: DocumentHint;
  isDownloadable: boolean;
}

export interface DetailCollectorInput {
  sourceUrl: string;
  procedureNumber: string | null;
  expedienteId: string | null;
  scope: string;
}

export interface DetailCollectorResult {
  procedureNumber: string | null;
  expedienteId: string | null;
  source: "ComprasMX";
  expedienteUrl: string;
  scope: string;
  documents: DocumentLink[];
  rawMetadata: Record<string, unknown>;
  collectorStatus: "ok" | "partial" | "no_documents" | "blocked" | "error";
  errors: string[];
}

// ── Helpers puros (exportados para tests) ─────────────────────────────────────

const DOCUMENT_LINK_KEYWORD_REGEX =
  /anexos?|documentos?|convocatoria|bases|archivos?|junta|aclaraciones|acta|fallo|contrato|pdf|docx?|xlsx?|zip|rar/i;

/**
 * Clasifica un documento a partir del nombre de archivo y título del link.
 */
export function classifyDocumentHint(
  fileName: string | null,
  title: string,
): DocumentHint {
  const text = `${fileName ?? ""} ${title}`.toLowerCase();
  if (/convocatoria|bases|invitaci[oó]n/.test(text)) return "convocatoria";
  if (/t[eé]cnico|tdr|t[eé]rminos/.test(text)) return "anexo_tecnico";
  if (/econ[oó]mico|precios|cat[aá]logo|conceptos/.test(text))
    return "anexo_economico";
  if (/legal|jur[ií]dico|requisitos/.test(text)) return "anexo_legal";
  if (/fallo|dictamen|adjudicaci[oó]n/.test(text)) return "fallo";
  if (/contrato|modelo|convenio/.test(text)) return "contrato";
  return "otro";
}

/**
 * Detecta el tipo de archivo desde la URL.
 */
export function extractFileType(url: string): FileType {
  const ext =
    url
      .split("?")[0]
      .split(".")
      .pop()
      ?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "docx";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "zip") return "zip";
  if (ext === "rar") return "rar";
  return "other";
}

export function buildAbsoluteDocumentUrl(href: string, sourceUrl: string): string {
  return href.startsWith("http") ? href : new URL(href, sourceUrl).toString();
}

export function isVisibleDocumentLinkCandidate(input: {
  href: string;
  text?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
}): boolean {
  const searchable = [
    input.href,
    input.text ?? "",
    input.ariaLabel ?? "",
    input.title ?? "",
  ].join(" ");
  return DOCUMENT_LINK_KEYWORD_REGEX.test(searchable);
}

// ── Función principal ──────────────────────────────────────────────────────────

/**
 * Abre el expediente en ComprasMX con Playwright y extrae todos los DocumentLinks.
 * Nunca hace throw — los errores se registran en el campo `errors` del resultado.
 */
export async function collectComprasMxDetail(
  input: DetailCollectorInput,
): Promise<DetailCollectorResult> {
  const baseResult: DetailCollectorResult = {
    procedureNumber: input.procedureNumber,
    expedienteId: input.expedienteId,
    source: "ComprasMX",
    expedienteUrl: input.sourceUrl,
    scope: input.scope,
    documents: [],
    rawMetadata: {},
    collectorStatus: "error",
    errors: [],
  };

  try {
    const documents = await BrowserManager.withContext(
      async (page) => {
        log.info(
          { url: input.sourceUrl, procedureNumber: input.procedureNumber },
          "🔍 Navigating to expediente...",
        );

        await page.goto(input.sourceUrl, {
          waitUntil: "domcontentloaded",
          timeout: LOAD_TIMEOUT_MS,
        });

        // Esperar que la SPA Angular cargue contenido
        await page
          .waitForSelector("a[href], button", { timeout: LOAD_TIMEOUT_MS })
          .catch(() => {
            // Si no hay links/botones, continuar igual
          });

        // Rate limit para no sobrecargar el servidor
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));

        const discoveredAt = nowISO();
        const found: DocumentLink[] = [];

        // Buscar todos los <a> con href sin hacer clic en anexos/documentos.
        const linkHandles = await page.$$("a[href]");

        for (const handle of linkHandles) {
          let href: string | null = null;
          try {
            href = await handle.getAttribute("href");
            if (!href) continue;

            const title = ((await handle.innerText().catch(() => "")) || "").trim();
            const ariaLabel = await handle.getAttribute("aria-label").catch(() => null);
            const titleAttr = await handle.getAttribute("title").catch(() => null);
            const fileType = extractFileType(href);
            const isDownloadable = fileType !== "other";

            if (
              !isVisibleDocumentLinkCandidate({
                href,
                text: title,
                ariaLabel,
                title: titleAttr,
              })
            ) continue;

            // Construir URL absoluta si es relativa
            const fileUrl = buildAbsoluteDocumentUrl(href, input.sourceUrl);

            const fileName =
              fileUrl.split("?")[0].split("/").pop() || null;

            const visibleName = title || titleAttr || ariaLabel || fileName || "Documento sin título";
            const documentHint = classifyDocumentHint(fileName, visibleName);

            found.push({
              documentTitle: visibleName,
              fileName: fileName || null,
              fileUrl,
              fileType,
              source: "ComprasMX",
              discoveredAt,
              documentHint,
              isDownloadable,
            });
          } catch (linkErr) {
            log.warn({ href, err: linkErr }, "⚠️ Error procesando link individual");
          }
        }

        return found;
      },
      { timeoutMs: LOAD_TIMEOUT_MS + RATE_LIMIT_MS + CONTEXT_BUFFER_MS },
    );

    if (documents.length === 0) {
      return { ...baseResult, collectorStatus: "no_documents", errors: [] };
    }

    return {
      ...baseResult,
      documents,
      collectorStatus: "ok",
      errors: [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, url: input.sourceUrl }, "❌ collectComprasMxDetail error");
    return {
      ...baseResult,
      collectorStatus: "error",
      errors: [msg],
    };
  }
}
