/** Mensaje de Telegram (HTML) de un evento de la vigilancia prioritaria. */
import type TelegramBot from "node-telegram-bot-api";
import { formatDetectionCdmx, formatLocalMilestone, esc } from "../procurement-calendar/format";
import { MILESTONE_LABELS } from "../procurement-calendar/types";
import type { WatchEvent, WatchSnapshot, WatchedProcedure } from "./types";

export interface SourceEvidence {
  source: string;
  url: string;
  documentDate: string | null;
  consultedAt: string;
  note?: string;
}

/** Próximo hito confirmado a partir de lo publicado (hora local CDMX, sin conversión). */
export function nextMilestone(snapshot: WatchSnapshot, nowLocal: string): string | null {
  const candidates: Array<{ label: string; at: string; hasTime: boolean }> = [];
  for (const [key, value] of Object.entries(snapshot.calendar.milestones)) {
    if (key === "publicacion" || !value.at) continue;
    candidates.push({ label: MILESTONE_LABELS[key as keyof typeof MILESTONE_LABELS], at: value.at, hasTime: value.hasTime });
  }
  if (snapshot.estimatedContractStart) {
    candidates.push({ label: "Inicio estimado del contrato", at: snapshot.estimatedContractStart.slice(0, 19), hasTime: false });
  }
  const upcoming = candidates.filter((item) => item.at > nowLocal).sort((a, b) => a.at.localeCompare(b.at))[0];
  return upcoming ? `${upcoming.label}: ${formatLocalMilestone({ at: upcoming.at, hasTime: upcoming.hasTime })}${upcoming.hasTime ? " CDMX" : ""}` : null;
}

export function formatWatchMessage(
  watched: WatchedProcedure, snapshot: WatchSnapshot, event: WatchEvent,
  options: { detectedAt: string; evidence?: SourceEvidence[]; nowLocal: string; uncertainResend?: boolean },
): string {
  const lines: string[] = [];
  if (options.uncertainResend) lines.push("↩️ <i>Reenvío: la entrega anterior de este aviso no pudo confirmarse.</i>");
  lines.push(`🔴 <b>BIRMEX · VIGILANCIA PRIORITARIA</b>`);
  lines.push(`${event.highlighted ? "⭐ " : ""}<b>${esc(event.title)}</b>`);
  lines.push(`🔢 <code>${esc(watched.procedure)}</code> · Expediente <code>${esc(snapshot.expediente)}</code>`);
  lines.push(esc(watched.label));
  lines.push("");
  for (const detail of event.details) lines.push(`• ${esc(detail)}`);
  const highlight = watched.highlight;
  if (highlight && snapshot.partidas.some((p) => p.highlighted) && !event.details.some((d) => d.includes("⭐"))) {
    const partida = snapshot.partidas.find((p) => p.highlighted);
    lines.push(`⭐ ${esc(highlight.label)}: ${esc(partida?.descripcion ?? "partida vigilada")} — sin cambios en este aviso.`);
  }
  lines.push("");
  lines.push(`🕒 Detectado: ${esc(formatDetectionCdmx(options.detectedAt))}`);
  const next = nextMilestone(snapshot, options.nowLocal);
  lines.push(`⏭ Próximo hito confirmado: ${esc(next ?? "ninguno publicado")}`);
  lines.push(`📎 Fuente oficial: Compras MX · consultado ${esc(formatDetectionCdmx(snapshot.capturedAt))}`);
  for (const item of options.evidence ?? []) {
    lines.push(`📎 Contraste: ${esc(item.source)}${item.documentDate ? ` (${esc(item.documentDate)})` : ""} · consultado ${esc(formatDetectionCdmx(item.consultedAt))}${item.note ? ` — ${esc(item.note)}` : ""}`);
  }
  if (/^https:\/\//i.test(snapshot.officialUrl)) lines.push(`🔗 <a href="${esc(snapshot.officialUrl)}"><b>Abrir expediente oficial</b></a>`);
  return lines.join("\n").slice(0, 3900);
}

/** Botones: calendario (existente) y enlace al expediente; el seguimiento de estos folios es prioritario y no se silencia. */
export function watchKeyboard(procurementId: string | null, officialUrl: string): TelegramBot.InlineKeyboardMarkup {
  const row: TelegramBot.InlineKeyboardButton[] = [];
  if (procurementId) row.push({ text: "📅 Ver calendario", callback_data: `cal:${procurementId}` });
  if (/^https:\/\//i.test(officialUrl)) row.push({ text: "🔗 Abrir expediente", url: officialUrl });
  return { inline_keyboard: [row] };
}
