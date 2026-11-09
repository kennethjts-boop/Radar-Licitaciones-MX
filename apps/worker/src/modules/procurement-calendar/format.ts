/** Mensajes de Telegram (HTML) del calendario y de sus cambios. */
import { formatMexicoDate } from "../../core/time";
import {
  MILESTONE_KEYS, MILESTONE_LABELS, noticeMilestone, type CalendarChange, type CalendarNotice, type CalendarSnapshot, type MilestoneValue,
} from "./types";

export const esc = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Hora local CDMX sin zona → "19/11/2026 10:00" (sin hora si el portal no la publica). */
export function formatLocalMilestone(value: MilestoneValue | null): string {
  if (!value?.at) return "Sin publicar";
  const match = value.at.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return "Sin publicar";
  const day = `${match[3]}/${match[2]}/${match[1]}`;
  return value.hasTime ? `${day} ${match[4]}:${match[5]}` : day;
}

/** ISO UTC del radar → hora de Ciudad de México. */
export function formatDetectionCdmx(iso: string | null | undefined): string {
  if (!iso) return "No disponible";
  return `${formatMexicoDate(iso, "dd/MM/yyyy HH:mm")} CDMX`;
}

const ICONS: Record<string, string> = {
  publicacion: "📰", junta_aclaraciones: "🗣", presentacion_apertura: "📂", fallo: "📋",
};

function noticeDates(notices: CalendarNotice[]): string {
  return notices.map((notice) => (notice.at ? formatLocalMilestone({ at: notice.at, hasTime: false }) : "s/f")).join(", ");
}

function noticeLine(notices: CalendarNotice[]): string {
  return `   ⚠️ Hay avisos oficiales de suspensión o diferimiento (${esc(noticeDates(notices))}). La fecha de arriba es la del cronograma; la vigente consta en el aviso.`;
}

export interface CalendarViewOptions {
  title?: string | null;
  buyer?: string | null;
  /** ISO UTC de la primera detección del radar (procurements.created_at). */
  firstDetectedAt?: string | null;
  /** true si se muestra el último calendario confirmado por falla del portal. */
  stale?: boolean;
  tracking?: boolean;
}

export function formatCalendarMessage(snapshot: CalendarSnapshot, options: CalendarViewOptions = {}): string {
  const lines: string[] = [
    `📅 <b>CALENDARIO · ${esc(snapshot.expediente)}</b>`,
  ];
  if (options.title) lines.push(`<b>${esc(options.title.replace(/\s+/g, " ").slice(0, 200))}</b>`);
  if (options.buyer) lines.push(`🏢 ${esc(options.buyer.slice(0, 120))}`);
  if (snapshot.portalStatus) lines.push(`📌 Estatus en el portal: ${esc(snapshot.portalStatus)}`);
  lines.push("");

  for (const key of MILESTONE_KEYS) {
    const value = snapshot.milestones[key];
    const verifiable = snapshot.verified.includes(key);
    const text = verifiable ? formatLocalMilestone(value) : "No verificable en esta fuente";
    lines.push(`${ICONS[key]} <b>${MILESTONE_LABELS[key]}:</b> ${esc(text)}`);
    if (key === "junta_aclaraciones") {
      if (snapshot.clarificationDeadline?.at) {
        lines.push(`   ✉️ Límite para enviar preguntas: ${esc(formatLocalMilestone(snapshot.clarificationDeadline))}`);
      }
    }
    const notices = snapshot.clarificationNotices.filter((notice) => noticeMilestone(notice) === key);
    if (notices.length > 0) lines.push(noticeLine(notices));
    if (key === "presentacion_apertura" && snapshot.submissionDeadline?.at) {
      lines.push(`   ⏳ Fecha límite de entrega de proposiciones: ${esc(formatLocalMilestone(snapshot.submissionDeadline))}`);
    }
    if (key === "fallo" && snapshot.falloActa) {
      lines.push(`   ✅ Acta de fallo publicada${snapshot.falloActa.publishedAt ? ` (${esc(formatLocalMilestone({ at: snapshot.falloActa.publishedAt, hasTime: false }))})` : ""}.`);
    }
  }

  const general = snapshot.clarificationNotices.filter((notice) => noticeMilestone(notice) === null);
  if (general.length > 0) lines.push(`⚠️ Otros avisos oficiales de cambio (${esc(noticeDates(general))}); revisar en el expediente.`);
  lines.push("");
  const publication = snapshot.milestones.publicacion;
  lines.push(`🗓 Publicación oficial: ${esc(snapshot.verified.includes("publicacion") ? formatLocalMilestone(publication) : "No verificable en esta fuente")}`);
  lines.push(`👁 Detectado por el radar: ${esc(formatDetectionCdmx(options.firstDetectedAt))}`);
  lines.push(`🕒 Calendario confirmado: ${esc(formatDetectionCdmx(snapshot.capturedAt))}`);
  if (options.stale) {
    lines.push("⚠️ El portal no respondió; se muestra el último calendario confirmado.");
  }
  for (const limitation of snapshot.limitations) lines.push(`ℹ️ ${esc(limitation)}`);
  if (/^https:\/\//i.test(snapshot.officialUrl)) {
    lines.push("", `🔗 <a href="${esc(snapshot.officialUrl)}"><b>Abrir expediente oficial</b></a>`);
  }
  if (options.tracking !== undefined) {
    lines.push(options.tracking ? "🔔 Seguimiento activo: te aviso de cada fecha nueva o modificada." : "🔕 Sin seguimiento. Pulsa «Avisarme de cambios» para activarlo.");
  }
  return lines.join("\n").slice(0, 3900);
}

export function formatChangeMessage(
  snapshot: CalendarSnapshot,
  changes: CalendarChange[],
  options: { detectedAt: string; title?: string | null } = { detectedAt: snapshot.capturedAt },
): string {
  const lines: string[] = ["🔔 <b>CAMBIO EN EL CALENDARIO</b>", `<b>${esc(snapshot.expediente)}</b>`];
  if (options.title) lines.push(esc(options.title.replace(/\s+/g, " ").slice(0, 160)));
  lines.push("");
  for (const change of changes) {
    if (change.kind === "new") {
      lines.push(`🆕 <b>${esc(change.label)}</b> ya tiene fecha: Sin publicar → <b>${esc(formatLocalMilestone(change.next))}</b>`);
    } else if (change.kind === "modified") {
      lines.push(`✏️ <b>${esc(change.label)}</b> cambió: ${esc(formatLocalMilestone(change.previous))} → <b>${esc(formatLocalMilestone(change.next))}</b>`);
    } else if (change.kind === "aviso" && change.notice) {
      const date = change.notice.at ? ` (${esc(formatLocalMilestone({ at: change.notice.at, hasTime: false }))})` : "";
      const milestone = noticeMilestone(change.notice);
      const target = milestone ? `de ${MILESTONE_LABELS[milestone].toLowerCase()}` : "del hito señalado";
      lines.push(`⚠️ <b>Aviso oficial de ${change.notice.kind === "suspension" ? "suspensión" : change.notice.kind === "diferimiento" ? "diferimiento" : "cambio"}</b>${date}: ${esc(change.notice.title)}. La nueva fecha ${esc(target)} consta en el aviso.`);
    } else if (change.kind === "acta_fallo" && change.notice) {
      lines.push(`✅ <b>Se publicó el acta de fallo</b>: ${esc(change.notice.title)}`);
    }
  }
  lines.push("", `🕒 Detectado: ${esc(formatDetectionCdmx(options.detectedAt))}`);
  if (/^https:\/\//i.test(snapshot.officialUrl)) {
    lines.push(`🔗 <a href="${esc(snapshot.officialUrl)}"><b>Abrir expediente oficial</b></a>`);
  }
  return lines.join("\n").slice(0, 3900);
}
