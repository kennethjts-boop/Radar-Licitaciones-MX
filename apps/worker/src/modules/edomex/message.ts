/**
 * Tarjeta Telegram de los focos Edomex. Distingue fecha oficial de publicación
 * de fecha de primera detección y nunca presenta un monto pendiente como si
 * superara el umbral.
 */
import {
  EDOMEX_FOCUS_KEYS,
  SECOGEM_SOURCE_KEY,
  type EdomexFocusKey,
} from "../../radars/edomex-focus.matcher";
import type { EnrichedAlert } from "../../types/procurement";

const LABELS: Record<EdomexFocusKey, string> = {
  [EDOMEX_FOCUS_KEYS.issemym]: "🏥 EDOMEX · ISSEMyM",
  [EDOMEX_FOCUS_KEYS.carreteras]: "🛣 EDOMEX · Carreteras > $100 MDP",
  [EDOMEX_FOCUS_KEYS.sitramytem]: "🚦 EDOMEX · SITRAMyTEM vial/mantenimiento",
  [EDOMEX_FOCUS_KEYS.oportunidades]: "🏛 EDOMEX · Alto monto estatal/municipal",
};

const esc = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function str(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dmy(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

function amountLine(alert: EnrichedAlert): string {
  const p = alert.procurement;
  const raw = p.rawJson as Record<string, unknown>;
  if (typeof p.amount === "number" && p.amount > 0) {
    return `💰 Monto explícito del contrato: $${p.amount.toLocaleString("es-MX")} MXN`;
  }
  if (alert.radarKey === EDOMEX_FOCUS_KEYS.issemym) return "💰 Monto no publicado (ISSEMyM: aplica cualquier monto).";
  if (raw.monto_estado === "convocatoria_agrupada") {
    return "💰 Convocatoria agrupada: sin monto individual confirmado. Pendiente de revisión; no se afirma que supere el umbral.";
  }
  const threshold = alert.radarKey === EDOMEX_FOCUS_KEYS.carreteras ? "$100 MDP" : "$20 MDP";
  return alert.radarKey === EDOMEX_FOCUS_KEYS.sitramytem && !/highway/.test((alert.scoreReasons ?? []).join(" "))
    ? "💰 Monto no publicado; mantenimiento acotado sin umbral."
    : `💰 Monto pendiente: candidata para revisión; falta confirmar que supere ${threshold}. Capital contable o costo de bases no cuentan.`;
}

export function formatEdomexTelegramAlert(alert: EnrichedAlert): string {
  const p = alert.procurement;
  const raw = p.rawJson as Record<string, unknown>;
  const secogem = p.source === SECOGEM_SOURCE_KEY;
  const label = LABELS[alert.radarKey as EdomexFocusKey] ?? "🏛 EDOMEX";
  const numbers = Array.isArray(raw.convocatoria_procedimientos)
    ? (raw.convocatoria_procedimientos as unknown[]).filter((n): n is string => typeof n === "string")
    : [];
  const reference = p.procedureNumber ?? p.licitationNumber ?? p.externalId;
  const publication = secogem ? str(raw, "fecha_publicacion_oficial") : (str(raw, "fecha_publicacion") ?? p.publicationDate);
  const deadline = secogem ? str(raw, "fecha_limite_inscripcion") : null;
  const opening = secogem ? str(raw, "fecha_apertura") : (str(raw, "fecha_apertura") ?? p.openingDate);
  const firstSeen = str(raw, "primera_deteccion") ?? alert.detectedAt;
  const lines = [
    "🚨 <b>GOSS · NUEVA LICITACIÓN</b>",
    `<b>${esc(label)}</b>`,
    "",
    `<b>${esc(p.title.replace(/\s+/g, " ").slice(0, 400))}</b>`,
    `🔢 <code>${esc(reference)}</code>`,
  ];
  if (numbers.length > 1) {
    lines.push(`🗂 Convocatoria con ${numbers.length} procedimientos: ${esc(numbers.slice(0, 8).join(", "))}${numbers.length > 8 ? "…" : ""}`);
  }
  const buyer = [p.dependencyName, p.buyingUnit].filter(Boolean).join(" · ");
  if (buyer) lines.push(`🏢 ${esc(buyer.slice(0, 160))}`);
  lines.push(amountLine(alert));
  lines.push(publication
    ? `📅 Publicación oficial: ${esc(dmy(publication) ?? publication)}`
    : "📅 Publicación oficial: no consta en el índice");
  lines.push(`👁 Primera detección del radar: ${esc(dmy(firstSeen.slice(0, 10)) ?? firstSeen)}`);
  lines.push(deadline
    ? `⏳ Límite de inscripción/bases: ${esc(dmy(deadline) ?? deadline)}`
    : "⏳ Fecha límite de inscripción: revisar en la convocatoria");
  if (opening) lines.push(`📂 Apertura: ${esc(dmy(opening) ?? opening)}`);
  lines.push("📋 Antes de afirmar que podemos participar: revisar fecha límite, requisitos, capital contable y capacidad técnica en las bases.");
  if (/^https:\/\//i.test(p.sourceUrl)) {
    lines.push("", `🔗 <a href="${esc(p.sourceUrl)}"><b>${secogem ? "Convocatoria oficial (PDF SECOGEM)" : "Abrir expediente en ComprasMX"}</b></a>`);
  }
  lines.push(secogem
    ? "🐕 Vigilancia posible: sólo cambios del PDF de la convocatoria; no anexos, juntas, actas ni fallos."
    : "🐕 Vigilancia posible: documentos, fechas y partidas del expediente en ComprasMX.");
  return lines.join("\n").slice(0, 3900);
}
