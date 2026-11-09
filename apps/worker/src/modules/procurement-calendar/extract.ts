/** Extracción pura del calendario desde las fuentes oficiales. */
import {
  MILESTONE_KEYS, MILESTONE_LABELS, type CalendarNotice, type CalendarSnapshot, type MilestoneKey, type MilestoneValue,
} from "./types";

const EMPTY: MilestoneValue = { at: null, hasTime: false };

/** "2026-11-19T10:00:00" | "2026-11-19" | "19/11/2026 10:00" → hora local CDMX normalizada. */
export function toMilestone(raw: unknown): MilestoneValue {
  if (typeof raw !== "string" || !raw.trim()) return EMPTY;
  const value = raw.trim();
  let match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  let parts: [string, string, string, string | undefined, string | undefined] | null = null;
  if (match) parts = [match[1], match[2], match[3], match[4], match[5]];
  else {
    match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if (match) parts = [match[3], match[2], match[1], match[4], match[5]];
  }
  if (!parts) return EMPTY;
  const [year, month, day, hour, minute] = parts;
  const hasTime = hour !== undefined && !(hour === "00" && (minute ?? "00") === "00");
  return { at: `${year}-${month}-${day}T${hour ?? "00"}:${minute ?? "00"}:00`, hasTime };
}

interface Anexo {
  numero?: number;
  descripcion?: string | null;
  nombre_archivo?: string | null;
  uuid_documento?: string | null;
  tipodoc_descripcion?: string | null;
  fecha_creacion?: string | null;
}

const NOTICE = /suspensi[oó]n|diferimient|difiere|reprogram|pospon|cambio de fecha|modificaci[oó]n de fecha/i;
const FALLO_ACTA = /acta de fallo|notificaci[oó]n de fallo|^fallo$|\bfallo\b/i;
const NOT_FALLO_ACTA = /aviso|difer|suspens|fecha|convocatoria|junta/i;

function anexoId(item: Anexo): string {
  return item.uuid_documento ?? `${item.nombre_archivo ?? item.descripcion ?? "anexo"}@${item.fecha_creacion ?? ""}`;
}

/** Avisos de suspensión/diferimiento de la junta y acta de fallo publicadas como anexos. */
export function noticesFromAnexos(anexos: unknown): {
  notices: CalendarNotice[];
  falloActa: CalendarSnapshot["falloActa"];
} {
  const list = Array.isArray(anexos) ? (anexos as Anexo[]) : [];
  const notices: CalendarNotice[] = [];
  let falloActa: CalendarSnapshot["falloActa"] = null;
  for (const item of list) {
    const text = `${item.tipodoc_descripcion ?? ""} ${item.descripcion ?? ""}`;
    if (NOTICE.test(text)) {
      notices.push({
        id: anexoId(item), title: (item.descripcion ?? item.tipodoc_descripcion ?? "Aviso").trim(),
        at: toMilestone(item.fecha_creacion).at,
        kind: /suspensi/i.test(text) ? "suspension" : /difer/i.test(text) ? "diferimiento" : "aviso",
      });
    } else if (FALLO_ACTA.test(text) && !NOT_FALLO_ACTA.test(text)) {
      falloActa ??= { id: anexoId(item), title: (item.descripcion ?? "Acta de fallo").trim(), publishedAt: toMilestone(item.fecha_creacion).at };
    }
  }
  return { notices: notices.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "")), falloActa };
}

export interface ComprasMxDetailData {
  registro?: Array<Record<string, unknown>>;
  anexos?: unknown;
}

/** Calendario completo: el detalle de ComprasMX publica los cuatro hitos. */
export function calendarFromComprasMxDetail(input: {
  procurementId: string;
  officialUrl: string;
  capturedAt: string;
  data: ComprasMxDetailData;
  /** `fecha_limite` del listado, si la fuente la distingue de la apertura. */
  listingDeadline?: string | null;
}): CalendarSnapshot | null {
  const record = input.data.registro?.[0];
  if (!record) return null;
  const apertura = toMilestone(record.fecha_apertura);
  const deadlineRaw = toMilestone(input.listingDeadline ?? record.fecha_limite ?? record.fecha_limite_presentacion);
  const { notices, falloActa } = noticesFromAnexos(input.data.anexos);
  return {
    procurementId: input.procurementId,
    expediente: String(record.numero_procedimiento ?? ""),
    source: "comprasmx",
    officialUrl: input.officialUrl,
    capturedAt: input.capturedAt,
    portalStatus: typeof record.estatus === "string" ? record.estatus : null,
    milestones: {
      publicacion: toMilestone(record.fecha_publicacion),
      junta_aclaraciones: toMilestone(record.fecha_junta_aclaracion),
      presentacion_apertura: apertura,
      fallo: toMilestone(record.fecha_acto_fallo),
    },
    submissionDeadline: deadlineRaw.at && deadlineRaw.at !== apertura.at ? deadlineRaw : null,
    clarificationDeadline: toMilestone(record.fecha_limite_aclaracion ?? record.fecha_limite_envio_aclaracion).at
      ? toMilestone(record.fecha_limite_aclaracion ?? record.fecha_limite_envio_aclaracion) : null,
    clarificationNotices: notices,
    falloActa,
    verified: [...MILESTONE_KEYS],
    limitations: [],
  };
}

/** Convocatorias SECOGEM: solo un PDF/índice; se afirman únicamente los hitos que consten. */
export function calendarFromSecogem(input: {
  procurementId: string;
  expediente: string;
  officialUrl: string;
  capturedAt: string;
  rawJson: Record<string, unknown>;
}): CalendarSnapshot {
  const publicacion = toMilestone(input.rawJson.fecha_publicacion_oficial);
  const apertura = toMilestone(input.rawJson.fecha_apertura);
  const inscripcion = toMilestone(input.rawJson.fecha_limite_inscripcion);
  const verified: MilestoneKey[] = [];
  if (publicacion.at) verified.push("publicacion");
  if (apertura.at) verified.push("presentacion_apertura");
  const missing = MILESTONE_KEYS.filter((key) => !verified.includes(key));
  return {
    procurementId: input.procurementId, expediente: input.expediente, source: "secogem_pdf",
    officialUrl: input.officialUrl, capturedAt: input.capturedAt, portalStatus: null,
    milestones: {
      publicacion, junta_aclaraciones: EMPTY, presentacion_apertura: apertura, fallo: EMPTY,
    },
    submissionDeadline: inscripcion.at && inscripcion.at !== apertura.at ? inscripcion : null,
    clarificationDeadline: null, clarificationNotices: [], falloActa: null, verified,
    limitations: [
      "Fuente: índice y PDF de la convocatoria (SECOGEM); no publica junta, fallo ni avisos.",
      verified.length > 0
        ? `Hitos verificados: ${verified.map((k) => MILESTONE_LABELS[k]).join(", ")}. No verificables en esta fuente: ${missing.map((k) => MILESTONE_LABELS[k]).join(", ")}.`
        : "Ningún hito pudo verificarse con esta fuente.",
    ],
  };
}

/** Respaldo cuando el portal no responde y no hay calendario previo: solo lo guardado en BD. */
export function calendarFromDbRow(input: {
  procurementId: string;
  expediente: string;
  officialUrl: string;
  capturedAt: string;
  publicationDate: string | null;
  openingDate: string | null;
  status: string | null;
}): CalendarSnapshot {
  const publicacion = toMilestone(input.publicationDate);
  const apertura = toMilestone(input.openingDate);
  const verified: MilestoneKey[] = [];
  if (publicacion.at) verified.push("publicacion");
  if (apertura.at) verified.push("presentacion_apertura");
  return {
    procurementId: input.procurementId, expediente: input.expediente, source: "db",
    officialUrl: input.officialUrl, capturedAt: input.capturedAt, portalStatus: input.status,
    milestones: { publicacion, junta_aclaraciones: EMPTY, presentacion_apertura: apertura, fallo: EMPTY },
    submissionDeadline: null, clarificationDeadline: null, clarificationNotices: [], falloActa: null, verified,
    limitations: ["El portal no respondió y no hay calendario confirmado previo; solo se muestran fechas guardadas por el radar (sin hora)."],
  };
}
