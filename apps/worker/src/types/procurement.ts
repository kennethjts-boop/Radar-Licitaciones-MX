/**
 * TIPOS CENTRALES — RADAR LICITACIONES MX
 * Contrato de datos normalizado para cualquier fuente de licitaciones.
 * Todos los collectors DEBEN producir NormalizedProcurement.
 */

// ─── Enumeraciones base ──────────────────────────────────────────────────────

export type ProcedureType =
  | "licitacion_publica"
  | "invitacion_tres"
  | "adjudicacion_directa"
  | "concurso"
  | "subasta"
  | "unknown";

export type ProcurementStatus =
  | "publicada"
  | "activa"
  | "en_proceso"
  | "desierta"
  | "cancelada"
  | "adjudicada"
  | "cerrada"
  | "unknown";

export type AlertType =
  | "new_match"
  | "status_change"
  | "new_document"
  | "daily_summary"
  | "system";

export type MatchLevel = "high" | "medium" | "low";

export type CollectorStatus = "running" | "success" | "error" | "timeout";

// ─── Attachment ──────────────────────────────────────────────────────────────

export interface ProcurementAttachment {
  fileName: string;
  fileType: string | null;
  fileUrl: string;
  fileHash: string | null;
  detectedText: string | null;
}

// ─── Contrato normalizado central ────────────────────────────────────────────
// Este es el tipo que circula entre collector → normalizer → matcher → enricher → alert.

export interface NormalizedProcurement {
  // Identificación de fuente
  source: string; // 'comprasmx' | 'dof' | 'institutional' | 'fallback'
  sourceUrl: string; // URL directa al expediente (siempre obligatorio)
  externalId: string; // ID único en la fuente original

  // Identificadores del expediente
  expedienteId: string | null; // Código/número de expediente (e.g. EA-009000002-E1-2024)
  licitationNumber: string | null; // Número de licitación oficial si existe
  procedureNumber: string | null; // Número de procedimiento si es diferente

  // Descripción
  title: string; // Título del procedimiento
  description: string | null; // Descripción detallada

  // Entidades
  dependencyName: string | null; // Dependencia convocante
  buyingUnit: string | null; // Unidad compradora

  // Clasificación
  procedureType: ProcedureType;
  status: ProcurementStatus;

  // Fechas (ISO-8601 strings o null)
  publicationDate: string | null;
  openingDate: string | null;
  awardDate: string | null;

  // Geografía
  state: string | null;
  municipality: string | null;

  // Económico
  amount: number | null;
  currency: "MXN" | "USD" | null;

  // Adjuntos
  attachments: ProcurementAttachment[];

  // Texto canónico para fingerprint y matching
  canonicalText: string; // título + descripción + dependencia + unidad + términos adjuntos
  canonicalFingerprint: string; // SHA-256 hex del canonicalText
  lightweightFingerprint: string | null;
  canonicalHash: string | null; // SHA-256 de numero_procedimiento + expediente_id (deduplicación cross-ID)

  // Raw original (preservar siempre)
  rawJson: Record<string, unknown>;

  // Timestamps de colección
  fetchedAt: string; // ISO-8601
}

// ─── Resultado de matching ───────────────────────────────────────────────────

export interface MatchResult {
  radarKey: string;
  procurementId: string; // external_id o id interno
  matchScore: number; // 0.0 – 1.0
  matchLevel: MatchLevel;
  matchedTerms: string[];
  excludedTerms: string[];
  explanation: string;
  isNew: boolean; // true si el expediente no existía antes
  isStatusChange: boolean;
  previousStatus: ProcurementStatus | null;
}

// ─── Resultado de colección ──────────────────────────────────────────────────

export interface CollectRunResult {
  collectorKey: string;
  sourceId: string;
  startedAt: string;
  finishedAt: string;
  status: CollectorStatus;
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
}

// ─── Alerta enriquecida ──────────────────────────────────────────────────────

export interface EnrichedAlert {
  alertType: AlertType;
  radarKey: string;
  radarName: string;
  matchLevel: MatchLevel;
  matchScore: number;
  procurement: NormalizedProcurement;
  matchedTerms: string[];
  explanation: string;
  hasHistory: boolean;
  historyCount: number;
  detectedAt: string; // ISO-8601
  telegramMessage: string; // Mensaje ya formateado para Telegram
  /** Modalidad de contratación probable según topes PEF. Presente si el expediente tiene monto. */
  modalidadProbable?: string;
}

// ─── Resumen diario ──────────────────────────────────────────────────────────

export interface DailySummary {
  summaryDate: string; // YYYY-MM-DD
  totalSeen: number;
  totalNew: number;
  totalUpdated: number;
  totalMatches: number;
  totalAlerts: number;
  matchesByRadar: Record<string, number>;
  topDependencies: Array<{ name: string; count: number }>;
  technicalIncidents: string[];
  telegramMessage: string;
}

// ─── Configuración de radar ──────────────────────────────────────────────────

export interface RadarRule {
  ruleType: "keyword" | "entity" | "geo" | "status" | "dependency";
  fieldName: string;
  operator: "contains" | "exact" | "any_of" | "none_of" | "regex";
  value: string | string[];
  weight: number; // 0.0 – 1.0
  isRequired: boolean;
}

export interface RadarConfig {
  key: string;
  name: string;
  description: string;
  isActive: boolean;
  priority: number; // 1 (alta) – 5 (baja)
  scheduleMinutes: number;
  includeTerms: string[];
  excludeTerms: string[];
  geoTerms: string[];
  entityTerms: string[];
  rules: RadarRule[];
  minScore: number; // 0.0 – 1.0, umbral para disparar alerta
}
