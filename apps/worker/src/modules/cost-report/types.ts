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

export interface ProviderLine {
  provider: CostProvider;
  /** Gasto informado por el proveedor, alineado al día MX y atribuible a Radar. */
  reportedUsd: number | null;
  /** Estimación con uso medido × tarifa verificada, para el día MX. */
  estimatedUsd: number | null;
  /** Detalle legible de la estimación (unidades medidas). */
  estimateDetail?: string;
  reference?: ReferenceFigure;
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
  retries: number;
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
}

export interface DayCostMetrics {
  /** Día reportado (YYYY-MM-DD, America/Mexico_City). */
  date: string;
  periodStartUtc: string;
  periodEndUtc: string;
  providers: ProviderLine[];
  ai: AiStats | null;
  totals: CostTotals;
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
