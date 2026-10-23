import { load } from "cheerio";
import { createHash } from "crypto";
import { normalizeText } from "../../core/text";

export const EDOMEX_PAGES = [
  "https://portal.secogem.gob.mx/convocatorias-obra-publica",
  "https://portal.secogem.gob.mx/convocatorias-bienes-servicios",
] as const;

export interface EdomexNotice {
  id: string;
  number: string;
  title: string;
  url: string;
  category: "issemym" | "carreteras" | "oportunidades";
  amount: number | null;
}

const ROAD = /\b(?:carreteras?|caminos?|vialidades?|paviment\w*|bacheo|asfalt\w*|carriles?|semaforos?|senalamiento)\b/;
const BUSINESS = /\b(?:rehabilitacion|conservacion|mantenimiento|construccion|suministro|adquisicion|arrendamiento|limpieza|vigilancia|seguridad|equipamiento|vehiculos?|medicamentos?|medic\w*|software|informat\w*|plataforma|tecnolog\w*|mobiliario|uniformes?|agua|drenaje|alumbrado)\b/;
const LARGE_SCOPE = /\b(?:integral|estatal|hospital\w*|plataforma|flota|maquinaria|medicamentos|infraestructura|diversos municipios|varios municipios|red de|unidades medicas)\b/;
const LARGE_ROAD_SCOPE = /\b(?:residencia regional|red carretera|carreteras?|tramo carretero|camino (?:no\.?\s*)?\d+)\b/;
// Un servicio puntual en un sistema de transporte sí puede interesar. Se excluye
// el diseño/construcción integral y la supervisión de esas megaobras.
const MEGAPROJECT = /\b(?:llave en mano|concesion\w*|teleferico|viaducto|tunel\w*)\b|(?:linea\s+\d+\s+del?\s+mexibus|mexicable\s+linea)/;

/** Sólo importes explícitos del contrato; jamás capital contable o costo de bases. */
export function explicitContractAmount(text: string): number | null {
  const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\b(?:usd|dolares)\b/.test(normalized)) return null;
  const amounts = [...normalized.matchAll(/(?:presupuesto (?:base|autorizado)(?: de (?:la )?obra)?|monto (?:estimado|del contrato))\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(millones|mdp)?/g)]
    .map((match) => Number(match[1].replace(/,/g, "")) * (match[2] ? 1_000_000 : 1));
  return amounts.length === 1 && Number.isFinite(amounts[0]) ? amounts[0] : null;
}

export function selectNotice(number: string, title: string, url: string): EdomexNotice | null {
  const text = normalizeText(`${number} ${title}`);
  const issemym = /\bissemy?m\b|instituto de seguridad social del estado de mexico y municipios/.test(text);
  if (!issemym && (MEGAPROJECT.test(text) || (!BUSINESS.test(text) && !ROAD.test(text)))) return null;
  const category = issemym ? "issemym" : ROAD.test(text) ? "carreteras" : "oportunidades";
  const amount = explicitContractAmount(title);
  // Referencia inicial de alto monto para los demás giros: 20 MDP.
  // ISSEMyM conserva la excepción explícita de cualquier monto.
  if (category === "carreteras" && amount !== null && amount <= 100_000_000) return null;
  if (category === "carreteras" && amount === null && !LARGE_ROAD_SCOPE.test(text) && !/sitramytem/.test(text)) return null;
  if (category === "oportunidades" && amount !== null && amount < 20_000_000) return null;
  if (category === "oportunidades" && amount === null && !LARGE_SCOPE.test(text)) return null;
  return { id: createHash("sha256").update(`${number}|${url}`).digest("hex").slice(0, 24),
    number, title, url, category, amount };
}

export function parseEdomexPage(html: string): { allIds: string[]; notices: EdomexNotice[] } {
  const $ = load(html);
  const allIds: string[] = [];
  const notices: EdomexNotice[] = [];
  $("tr").each((_, element) => {
    const row = $(element);
    const firstCell = row.find("td").first().text().replace(/\s+/g, " ").trim();
    const encoded = firstCell.match(/^(.+?)\^(.+\.pdf(?:\?[^\s]*)?)$/i);
    const link = row.find('a[href]').filter((_, a) => /\.pdf(?:\?|$)/i.test($(a).attr("href") ?? "")).first();
    const href = encoded?.[2] ?? link.attr("href");
    if (!href) return;
    let url: URL;
    try { url = new URL(href, EDOMEX_PAGES[0]); } catch { return; }
    if (url.protocol !== "https:" || url.hostname !== "portal.secogem.gob.mx") return;
    const number = encoded?.[1] ?? firstCell;
    const title = row.find("td").slice(1).text().replace(/\^/g, " · ").replace(/\s+/g, " ").trim();
    const id = createHash("sha256").update(`${number}|${url.href}`).digest("hex").slice(0, 24);
    allIds.push(id);
    const notice = selectNotice(number, title, url.href);
    if (notice) notices.push(notice);
  });
  // Un HTML de bloqueo o un cambio de plantilla no debe resetear la línea base.
  if (allIds.length < 3) throw new Error("Índice Edomex vacío o no reconocido");
  return { allIds: [...new Set(allIds)], notices };
}

export const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function noticeMessage(notice: EdomexNotice): string {
  const amount = notice.amount === null
    ? notice.category === "carreteras" ? "Monto pendiente: confirmar que supere $100 MDP." : "Monto pendiente de confirmar; candidata para revisión."
    : `$${notice.amount.toLocaleString("es-MX")} MXN`;
  return `🏛 <b>EDOMEX · ${notice.category === "issemym" ? "ISSEMyM" : "Candidata"}</b>\n<b>${escapeHtml(notice.number.slice(0, 250))}</b>\n${escapeHtml(notice.title.slice(0, 1800))}\n\n💰 ${amount}\n📋 Revisar vigencia, bases y capacidad técnica/financiera antes de concursar.\n<a href="${escapeHtml(notice.url)}">Convocatoria oficial</a>\n\n🐕 ¿Vigilar cambios en este PDF? Responde a este mensaje <b>sí</b> o <b>no</b>.`;
}
