import { load } from "cheerio";
import { createHash } from "crypto";
import { normalizeText, buildCanonicalText } from "../../core/text";
import { buildCanonicalHash, buildProcurementFingerprint } from "../../core/fingerprints";
import { nowISO } from "../../core/time";
import { SECOGEM_SOURCE_KEY } from "../../radars/edomex-focus.matcher";
import type { NormalizedProcurement, ProcedureType } from "../../types/procurement";

export const EDOMEX_PAGES = [
  "https://portal.secogem.gob.mx/convocatorias-obra-publica",
  "https://portal.secogem.gob.mx/convocatorias-bienes-servicios",
] as const;

export type EdomexPage = (typeof EDOMEX_PAGES)[number];
export const pageSlug = (page: string): string => page.split("/").pop() ?? page;

/** Fila del índice: una convocatoria (un PDF) que puede agrupar varios procedimientos. */
export interface EdomexConvocatoria {
  /** Misma identidad usada por la línea base de PR #63 (número|PDF). */
  rowId: string;
  page: string;
  numberCell: string;
  numbers: string[];
  url: string;
  dependency: string | null;
  description: string;
  headers: string[];
  cells: string[];
  officialPublicationDate: string | null;
  registrationDeadline: string | null;
  openingDate: string | null;
}

/** Sólo importes explícitos del contrato; jamás capital contable, costo de bases ni inversión del programa. */
export function explicitContractAmount(text: string): number | null {
  const normalized = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/\b(?:usd|dolares)\b/.test(normalized)) return null;
  const amounts = [...normalized.matchAll(/(?:presupuesto (?:base|autorizado|asignado)(?: de (?:la )?(?:obra|contratacion))?|monto (?:estimado|del contrato|maximo del contrato|autorizado de la obra))\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(millones|mdp)?/g)]
    .map((match) => Number(match[1].replace(/,/g, "")) * (match[2] ? 1_000_000 : 1));
  return amounts.length === 1 && Number.isFinite(amounts[0]) ? amounts[0] : null;
}

const MONTHS: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06", julio: "07",
  agosto: "08", septiembre: "09", setiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

/** Fecha explícita → yyyy-MM-dd; null si no hay una fecha inequívoca. */
export function parseSpanishDate(text: string): string | null {
  const value = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
  let m = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = value.match(/\b(\d{1,2}) de ([a-z]+) (?:de|del) (\d{4})\b/);
  if (m && MONTHS[m[2]]) return `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}`;
  return null;
}

/** Separa un número de convocatoria agrupada en sus procedimientos. */
export function splitProcedureNumbers(cell: string): string[] {
  const parts = cell.split(/\s*(?:,|;|\||\n|\s+y\s+|\s+e\s+)\s*/i)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 4 && /\d/.test(part));
  return parts.length > 0 ? [...new Set(parts)] : [cell.replace(/\s+/g, " ").trim()];
}

function dateByHeader(headers: string[], cells: string[], pattern: RegExp): string | null {
  const index = headers.findIndex((header) => pattern.test(normalizeText(header)));
  return index >= 0 && cells[index] ? parseSpanishDate(cells[index]) : null;
}

export function parseEdomexPage(html: string, page: string = EDOMEX_PAGES[0]): EdomexConvocatoria[] {
  const $ = load(html);
  const headers = $("thead th, tr th").map((_, th) => $(th).text().replace(/\s+/g, " ").trim()).get();
  const rows: EdomexConvocatoria[] = [];
  $("tr").each((_, element) => {
    const row = $(element);
    const tds = row.find("td");
    if (tds.length === 0) return;
    const firstCell = tds.first().text().replace(/\s+/g, " ").trim();
    const encoded = firstCell.match(/^(.+?)\^(.+\.pdf(?:\?[^\s]*)?)$/i);
    const link = row.find("a[href]").filter((_, a) => /\.pdf(?:\?|$)/i.test($(a).attr("href") ?? "")).first();
    const href = encoded?.[2] ?? link.attr("href");
    if (!href) return;
    let url: URL;
    try { url = new URL(href, EDOMEX_PAGES[0]); } catch { return; }
    if (url.protocol !== "https:" || url.hostname !== "portal.secogem.gob.mx") return;
    const numberCell = encoded?.[1] ?? firstCell;
    const cells = tds.map((_, td) => $(td).text().replace(/\s+/g, " ").trim()).get();
    const second = (tds.eq(1).text() ?? "").replace(/\s+/g, " ").trim();
    const [maybeDependency, ...rest] = second.split("^").map((part) => part.trim());
    const dependency = rest.length > 0 && maybeDependency ? maybeDependency : null;
    const extra = cells.slice(2).map((cell) => cell.replace(/\^/g, " · ")).filter(Boolean);
    const description = [rest.length > 0 ? rest.join(" · ") : second, ...extra].filter(Boolean).join(" · ");
    rows.push({
      rowId: createHash("sha256").update(`${numberCell}|${url.href}`).digest("hex").slice(0, 24),
      page,
      numberCell,
      numbers: splitProcedureNumbers(numberCell),
      url: url.href,
      dependency,
      description,
      headers,
      cells,
      // Sólo una columna rotulada como publicación cuenta como fecha oficial.
      officialPublicationDate: dateByHeader(headers, cells, /publicacion/),
      registrationDeadline: dateByHeader(headers, cells, /inscripcion|limite|venta de bases|adquisicion de bases/),
      openingDate: dateByHeader(headers, cells, /apertura|presentacion de propuestas/),
    });
  });
  // Un HTML de bloqueo o un cambio de plantilla no debe resetear la línea base.
  if (rows.length < 3) throw new Error("Índice Edomex vacío o no reconocido");
  const unique = new Map(rows.map((row) => [row.rowId, row]));
  return [...unique.values()];
}

function procedureType(number: string, page: string): ProcedureType {
  const n = normalizeText(number);
  if (/\b(?:ir|i3p|invitacion)\b|^ir[-/]/.test(n)) return "invitacion_tres";
  if (/\bad\b|adjudicacion directa/.test(n)) return "adjudicacion_directa";
  // Ambos índices publican convocatorias de licitación pública.
  return page.includes("convocatorias-") ? "licitacion_publica" : "unknown";
}

/**
 * Convierte una convocatoria en procedimientos normalizados. El monto sólo se
 * atribuye cuando la convocatoria contiene un único procedimiento: nunca se
 * reparte ni se asigna un presupuesto conjunto como si fuera individual.
 */
export function normalizeConvocatoria(
  row: EdomexConvocatoria,
  options: { firstDetectedAt: string; historical: boolean },
): NormalizedProcurement[] {
  const grouped = row.numbers.length > 1;
  const amount = grouped ? null : explicitContractAmount(row.description);
  return row.numbers.map((number) => {
    const title = row.description.slice(0, 500) || number;
    const canonicalText = buildCanonicalText({
      title, description: row.description, dependencyName: row.dependency, state: "MÉXICO",
    });
    return {
      source: SECOGEM_SOURCE_KEY,
      sourceUrl: row.url,
      externalId: `secogem:${number.toUpperCase()}`,
      expedienteId: null,
      licitationNumber: number,
      procedureNumber: number,
      title,
      description: row.description,
      dependencyName: row.dependency,
      buyingUnit: null,
      procedureType: procedureType(number, row.page),
      procedureTypeSource: "secogem_index",
      procedureTypeConfidence: "medium",
      status: "publicada",
      publicationDate: row.officialPublicationDate,
      openingDate: row.openingDate,
      awardDate: null,
      state: "MÉXICO",
      municipality: null,
      amount,
      currency: amount !== null ? "MXN" : null,
      attachments: [{ fileName: "convocatoria.pdf", fileType: "pdf", fileUrl: row.url, fileHash: null, detectedText: null }],
      canonicalText,
      canonicalFingerprint: buildProcurementFingerprint({
        title, description: row.description, dependencyName: row.dependency,
      }),
      lightweightFingerprint: null,
      canonicalHash: buildCanonicalHash(`secogem:${number}`, null),
      rawJson: {
        source_page: pageSlug(row.page),
        convocatoria_id: row.rowId,
        convocatoria_numero: row.numberCell,
        convocatoria_procedimientos: row.numbers,
        convocatoria_pdf: row.url,
        dependencia: row.dependency,
        encabezados: row.headers,
        celdas: row.cells,
        fecha_publicacion_oficial: row.officialPublicationDate,
        fecha_limite_inscripcion: row.registrationDeadline,
        fecha_apertura: row.openingDate,
        primera_deteccion: options.firstDetectedAt,
        monto_estado: amount !== null ? "explicito" : grouped ? "convocatoria_agrupada" : "no_publicado",
        historical_baseline: options.historical,
      },
      fetchedAt: nowISO(),
    };
  });
}

export const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
