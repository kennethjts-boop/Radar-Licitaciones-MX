/**
 * FINANCIAL CEILING RADAR — Tipos centrales del módulo.
 *
 * Aislado completamente del sistema principal de alertas.
 * Solo se usa cuando el usuario activa /techo o el CLI.
 */

// ─── Confianza del análisis ───────────────────────────────────────────────────

export type ConfidenceLevel = "ALTA" | "MEDIA" | "BAJA";

// ─── Tipo del techo detectado ─────────────────────────────────────────────────

export type CeilingType =
  | "confirmado_monto_maximo"
  | "confirmado_suficiencia_presupuestal"
  | "confirmado_valor_estimado"
  | "contrato_abierto"
  | "antecedente_inmediato"
  | "historico_similar"
  | "no_determinado";

// ─── Licitación analizada ─────────────────────────────────────────────────────

export interface AnalyzedTender {
  number: string;
  agency: string | null;
  buyerUnit: string | null;
  object: string | null;
  procedure: string | null;
  publicationDate: string | null;
  sources: string[];
}

// ─── Techo financiero ─────────────────────────────────────────────────────────

export interface FinancialCeiling {
  amount: number | null;
  rangeMin: number | null;
  rangeMax: number | null;
  currency: "MXN" | "USD";
  type: CeilingType;
  confidence: ConfidenceLevel;
  evidence: string;
}

// ─── Antecedente inmediato ────────────────────────────────────────────────────

export interface ImmediatePrecedent {
  contractNumber: string | null;
  tenderNumber: string | null;
  agency: string | null;
  supplier: string | null;
  amount: number | null;
  currency: "MXN" | "USD";
  date: string | null;
  similarityScore: number;
  sourceUrl: string | null;
  evidence: string | null;
}

// ─── Candidato similar ────────────────────────────────────────────────────────

export interface SimilarCandidate {
  expediente: string | null;
  object: string | null;
  supplier: string | null;
  amount: number | null;
  year: number | null;
  score: number;
  sourceUrl: string | null;
  agency: string | null;
}

// ─── Fuente consultada ────────────────────────────────────────────────────────

export interface SourceConsulted {
  url: string;
  document: string;
  consultedAt: string;
  relevantFragment: string | null;
  status: "ok" | "blocked" | "captcha" | "not_found" | "error";
  errorReason?: string;
}

// ─── Resultado completo del análisis ─────────────────────────────────────────

export interface FinancialCeilingReport {
  query: string;
  analyzedAt: string;
  currentTender: AnalyzedTender;
  financialCeiling: FinancialCeiling;
  immediatePrecedent: ImmediatePrecedent | null;
  similarCandidates: SimilarCandidate[];
  sourcesConsulted: SourceConsulted[];
  warnings: string[];
  errors: string[];
}

// ─── Datos crudos de un contrato/licitación extraído de fuente pública ────────

export interface PublicContractRaw {
  numero_expediente?: string | null;
  numero_licitacion?: string | null;
  dependencia?: string | null;
  unidad_compradora?: string | null;
  area_solicitante?: string | null;
  objeto_contratacion?: string | null;
  descripcion?: string | null;
  procedimiento?: string | null;
  fecha_publicacion?: string | null;
  fecha_fallo?: string | null;
  fecha_contrato?: string | null;
  proveedor_ganador?: string | null;
  monto_contrato?: number | null;
  monto_minimo?: number | null;
  monto_maximo?: number | null;
  presupuesto_autorizado?: number | null;
  suficiencia_presupuestal?: number | null;
  partida_presupuestal?: string | null;
  origen_recursos?: string | null;
  fondo_programa?: string | null;
  plazo_ejecucion?: string | null;
  vigencia?: string | null;
  moneda?: "MXN" | "USD" | string | null;
  url_fuente?: string | null;
  nombre_documento?: string | null;
  texto_evidencia?: string | null;
  confianza_extraccion?: ConfidenceLevel | null;
}

// ─── Scoring de similitud ─────────────────────────────────────────────────────

export interface SimilarityScoreDetail {
  total: number;
  breakdown: {
    sameDependency: number;
    sameBuyerUnit: number;
    objectMatchStrong: number;
    objectMatchPartial: number;
    sameCucop: number;
    sameBudgetLine: number;
    sameSupplier: number;
    immediateYear: number;
    officialDocument: number;
  };
  classification: "antecedente_fuerte" | "antecedente_probable" | "antecedente_debil" | "no_usar";
}

// ─── Parámetros de entrada ────────────────────────────────────────────────────

export interface FinancialAnalysisInput {
  query: string; // número de licitación o texto libre
}
