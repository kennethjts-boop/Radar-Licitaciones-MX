/**
 * Tipos del reporte diario de gastos. Todos los montos en USD; MXN nunca se
 * mezcla ni se convierte sin una fuente de tipo de cambio fiable.
 */

export type CostProvider = "openai" | "openrouter" | "railway" | "supabase";

/** Cifra informada por el proveedor que NO cubre exactamente el día MX o a Radar. */
export interface ReferenceFigure {
  usd: number;
  period: string;
  reason: string;
}

/**
 * Cobertura de la medición de un día MX:
 * - none: el día terminó antes de que existiera medición confiable ("sin datos").
 * - partial: la medición empezó durante el día o se perdieron eventos.
 * - complete: medición activa todo el día, sin pérdidas registradas.
 * Sólo los días complete entran a promedios y anomalías; none nunca es $0.
 */
export type CoverageStatus = "none" | "partial" | "complete";

export interface DayCoverage {
  status: CoverageStatus;
  /** Inicio de la medición confiable (ISO UTC), o null si aún no existe. */
  since: string | null;
  /** Eventos de IA que no se pudieron registrar ese día. */
  droppedEvents: number;
  /** La medición empezó dentro de este día. */
  sinceWithinDay?: boolean;
}

export interface ProviderCoverage {
  /** not_applicable: la cifra no depende del registro de IA de Radar. */
  status: CoverageStatus | "not_applicable";
  note?: string;
}

export interface ProviderLine {
  provider: CostProvider;
  /** Gasto informado por el proveedor, alineado al día MX y atribuible a Radar. */
  reportedUsd: number | null;
  /** Estimación con uso medido × tarifa verificada, para el día MX. */
  estimatedUsd: number | null;
  /** Detalle legible de la estimación (unidades medidas). */
  estimateDetail?: string;
  /** Métricas de uso no monetarias (no entran a totales ni anomalías). */
  metricsDetail?: string;
  reference?: ReferenceFigure;
  /** Contraste entre registro de Radar y la fuente del proveedor. */
  reconciliation?: string;
  coverage?: ProviderCoverage;
  /** Datos faltantes, retrasos o permisos mínimos requeridos. */
  missing: string[];
}

export interface AiModelStats {
  provider: "openai" | "openrouter";
  model: string;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number | null;
  reportedUsd: number | null;
}

export interface AiStats {
  requests: number;
  errors: number;
  /** Solicitudes observadas que reintentan con otro modelo del pool (attempt>1). */
  retries: number;
  /** Reintentos HTTP internos del SDK observados (http_attempts − 1). */
  httpRetries: number;
  /** Solicitudes cuyos reintentos internos no se pudieron medir (http_attempts NULL). */
  retriesUnobserved: number;
  inputTokens: number;
  outputTokens: number;
  /** Solicitudes de modelos sin tarifa verificada: su costo no se estima. */
  unpricedRequests: number;
  unverifiedPricingModels: string[];
  errorKinds: Record<string, number>;
  byModel: AiModelStats[];
}

export interface CostTotals {
  confirmedUsd: number | null;
  confirmedProviders: CostProvider[];
  estimatedUsd: number | null;
  estimatedProviders: CostProvider[];
  /** Proveedores sin cifra para el total estimado. */
  estimateExcludes: CostProvider[];
  /** Proveedores incluidos con medición parcial. */
  estimatePartial: CostProvider[];
}

export interface DayCostMetrics {
  /** Día reportado (YYYY-MM-DD, America/Mexico_City). */
  date: string;
  periodStartUtc: string;
  periodEndUtc: string;
  providers: ProviderLine[];
  ai: AiStats | null;
  totals: CostTotals;
  /** Ausente en reportes anteriores a la medición de cobertura: no comparable. */
  coverage?: DayCoverage;
}

export interface AnomalyThresholds {
  pct: number;
  minUsd: number;
  minDays: number;
  minRequests: number;
  minErrors: number;
}

export type ComparisonStatus = "ok" | "review" | "baseline";

export interface MetricComparison {
  key: string;
  label: string;
  unit: "usd" | "count";
  value: number;
  previous: number | null;
  average: number | null;
  sampleDays: number;
  status: ComparisonStatus;
  whereToCheck: string;
}
