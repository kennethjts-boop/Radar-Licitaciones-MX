/**
 * Calendario de hitos de una licitación. Las fechas del portal vienen como hora
 * local de Ciudad de México sin zona ("2026-11-19T10:00:00"); se conservan así y
 * nunca se convierten. Las marcas de tiempo del radar (detección, captura) son
 * ISO UTC y se presentan en hora de Ciudad de México.
 */
export const MILESTONE_KEYS = ["publicacion", "junta_aclaraciones", "presentacion_apertura", "fallo"] as const;
export type MilestoneKey = (typeof MILESTONE_KEYS)[number];

export const MILESTONE_LABELS: Record<MilestoneKey, string> = {
  publicacion: "Publicación de la convocatoria",
  junta_aclaraciones: "Junta de aclaraciones",
  presentacion_apertura: "Presentación y apertura de proposiciones",
  fallo: "Fallo",
};

export interface MilestoneValue {
  /** Hora local CDMX "AAAA-MM-DDTHH:mm:ss"; null = sin publicar. */
  at: string | null;
  /** false cuando el portal sólo publica el día (00:00:00). */
  hasTime: boolean;
}

export interface CalendarNotice {
  id: string;
  title: string;
  /** Fecha del aviso (hora local CDMX). */
  at: string | null;
  kind: "suspension" | "diferimiento" | "aviso";
  /** Hito al que se refiere el aviso (junta, apertura, fallo); null si no lo dice. */
  milestone?: MilestoneKey | null;
}

export type CalendarSource = "comprasmx" | "secogem_pdf" | "db";

export interface CalendarSnapshot {
  procurementId: string;
  expediente: string;
  source: CalendarSource;
  officialUrl: string;
  /** ISO UTC de la captura que confirmó este calendario. */
  capturedAt: string;
  portalStatus: string | null;
  milestones: Record<MilestoneKey, MilestoneValue>;
  /** Fecha límite de entrega de proposiciones cuando la fuente la distingue de la apertura. */
  submissionDeadline: MilestoneValue | null;
  /** Fecha límite para enviar preguntas de aclaración. */
  clarificationDeadline: MilestoneValue | null;
  /** Avisos oficiales de suspensión/diferimiento (de la junta, la apertura o el fallo; ver `milestone`). */
  clarificationNotices: CalendarNotice[];
  /** Acta de fallo ya publicada como documento. */
  falloActa: { id: string; title: string; publishedAt: string | null } | null;
  /** Hitos que esta fuente permite verificar (los demás no se afirman). */
  verified: MilestoneKey[];
  limitations: string[];
}

export type CalendarChangeKind = "new" | "modified" | "aviso" | "acta_fallo";

export interface CalendarChange {
  /** Clave de deduplicación: un aviso por cada valor nuevo o modificado. */
  dedupeKey: string;
  kind: CalendarChangeKind;
  label: string;
  previous: MilestoneValue | null;
  next: MilestoneValue | null;
  notice?: CalendarNotice;
}

/** Hito al que se refiere un aviso; infiere desde el título en calendarios guardados antes del campo. */
export function noticeMilestone(notice: Pick<CalendarNotice, "title" | "milestone">): MilestoneKey | null {
  if (notice.milestone !== undefined) return notice.milestone;
  const text = notice.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/fallo/.test(text)) return "fallo";
  if (/apertura|presentacion|proposicion/.test(text)) return "presentacion_apertura";
  if (/junta|aclaracion/.test(text)) return "junta_aclaraciones";
  return null;
}
