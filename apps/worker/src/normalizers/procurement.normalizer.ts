/**
 * NORMALIZER BASE — Convierte datos crudos de cualquier fuente al contrato NormalizedProcurement.
 * Cada collector produce un objeto crudo; este normalizer lo transforma.
 */
import { buildCanonicalText, normalizeText } from "../core/text";
import { buildProcurementFingerprint } from "../core/fingerprints";
import { nowISO } from "../core/time";
import type {
  NormalizedProcurement,
  ProcedureType,
  ProcurementStatus,
} from "../types/procurement";

// ─── Maps de normalización ────────────────────────────────────────────────────

const STATUS_MAP: Record<string, ProcurementStatus> = {
  publicada: "publicada",
  activa: "activa",
  "en proceso": "en_proceso",
  en_proceso: "en_proceso",
  desierta: "desierta",
  cancelada: "cancelada",
  adjudicada: "adjudicada",
  cerrada: "cerrada",
  concluida: "cerrada",
  finalizada: "cerrada",
  // Valores reales de la API comprasmx (normalizeText quita tildes/mayúsculas)
  vigente: "activa",
  "vigente sin acta": "activa",
  "vigente pap": "activa",
  "vigente ja": "activa",
  "en aclaraciones": "activa",
  "en atencion de preguntas": "activa",
  "en repreguntas": "activa",
  "pendiente de apertura": "en_proceso",
  "en apertura": "en_proceso",
  "en evaluacion": "en_proceso",
  "en decision de fallo": "en_proceso",
  suspendido: "en_proceso",
};

const PROCEDURE_TYPE_MAP: Record<string, ProcedureType> = {
  "licitación pública": "licitacion_publica",
  "licitacion publica": "licitacion_publica",
  lp: "licitacion_publica",
  "invitación a cuando menos tres personas": "invitacion_tres",
  "invitacion a cuando menos tres": "invitacion_tres",
  i3p: "invitacion_tres",
  "adjudicación directa": "adjudicacion_directa",
  "adjudicacion directa": "adjudicacion_directa",
  ad: "adjudicacion_directa",
  concurso: "concurso",
  subasta: "subasta",
};

/**
 * Normaliza un string de estatus a ProcurementStatus.
 */
export function normalizeStatus(
  raw: string | null | undefined,
): ProcurementStatus {
  if (!raw) return "unknown";
  const normalized = normalizeText(raw);
  return STATUS_MAP[normalized] ?? "unknown";
}

/**
 * Normaliza un string de tipo de procedimiento a ProcedureType.
 */
export function normalizeProcedureType(
  raw: string | null | undefined,
): ProcedureType {
  if (!raw) return "unknown";
  const normalized = normalizeText(raw);
  // Búsqueda exacta primero
  if (PROCEDURE_TYPE_MAP[normalized]) return PROCEDURE_TYPE_MAP[normalized];
  // Búsqueda parcial
  for (const [key, val] of Object.entries(PROCEDURE_TYPE_MAP)) {
    if (normalized.includes(key)) return val;
  }
  return "unknown";
}

/**
 * Normaliza un monto: acepta strings con $, comas, etc.
 */
export function normalizeAmount(
  raw: string | number | null | undefined,
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return isFinite(raw) ? raw : null;
  const cleaned = String(raw)
    .replace(/[$,\s]/g, "")
    .replace(/MXN|USD/gi, "")
    .trim();
  const num = parseFloat(cleaned);
  return isFinite(num) ? num : null;
}

/**
 * Parámetros mínimos que cada collector debe proporcionar al normalizer.
 */
export interface RawProcurementInput {
  source: string;
  sourceUrl: string;
  externalId: string;
  expedienteId?: string | null;
  licitationNumber?: string | null;
  procedureNumber?: string | null;
  title: string;
  description?: string | null;
  dependencyName?: string | null;
  buyingUnit?: string | null;
  procedureType?: string | null;
  status?: string | null;
  publicationDate?: string | null;
  openingDate?: string | null;
  awardDate?: string | null;
  state?: string | null;
  municipality?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  attachments?: Array<{
    fileName: string;
    fileType?: string | null;
    fileUrl: string;
    fileHash?: string | null;
    detectedText?: string | null;
  }>;
  rawJson: Record<string, unknown>;
}

/**
 * Normaliza un input crudo al contrato central NormalizedProcurement.
 */
export function normalize(input: RawProcurementInput): NormalizedProcurement {
  const attachments = (input.attachments ?? []).map((att) => ({
    fileName: att.fileName,
    fileType: att.fileType ?? null,
    fileUrl: att.fileUrl,
    fileHash: att.fileHash ?? null,
    detectedText: att.detectedText ?? null,
  }));

  const canonicalText = buildCanonicalText({
    title: input.title,
    description: input.description,
    dependencyName: input.dependencyName,
    buyingUnit: input.buyingUnit,
    state: input.state,
    attachmentTexts: attachments
      .map((a) => a.detectedText)
      .filter((t): t is string => !!t),
  });

  const canonicalFingerprint = buildProcurementFingerprint({
    title: input.title,
    description: input.description,
    dependencyName: input.dependencyName,
    buyingUnit: input.buyingUnit,
    expedienteId: input.expedienteId,
  });

  return {
    source: input.source,
    sourceUrl: input.sourceUrl,
    externalId: input.externalId,
    expedienteId: input.expedienteId ?? null,
    licitationNumber: input.licitationNumber ?? null,
    procedureNumber: input.procedureNumber ?? null,
    title: input.title.trim(),
    description: input.description?.trim() ?? null,
    dependencyName: input.dependencyName?.trim() ?? null,
    buyingUnit: input.buyingUnit?.trim() ?? null,
    procedureType: normalizeProcedureType(input.procedureType),
    status: normalizeStatus(input.status),
    publicationDate: input.publicationDate ?? null,
    openingDate: input.openingDate ?? null,
    awardDate: input.awardDate ?? null,
    state: input.state?.trim() ?? null,
    municipality: input.municipality?.trim() ?? null,
    amount: normalizeAmount(input.amount),
    currency: (input.currency as "MXN" | "USD" | null) ?? null,
    attachments,
    canonicalText,
    canonicalFingerprint,
    lightweightFingerprint: null,
    rawJson: input.rawJson,
    fetchedAt: nowISO(),
  };
}
