/**
 * Totales y comparaciones deterministas. Reglas:
 * - Confirmado = suma de gasto informado por proveedores, alineado al día MX
 *   y atribuible a Radar. Estimado = suma de estimaciones. Nunca se mezclan.
 * - Revisión: valor > promedio × (1 + pct) Y valor − promedio > mínimo
 *   absoluto, con al menos minDays días comparables. Es una señal para
 *   revisar, no prueba de fraude.
 */
import type {
  AnomalyThresholds,
  CostProvider,
  CostTotals,
  DayCostMetrics,
  MetricComparison,
  ProviderLine,
} from "./types";

export const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  pct: 50,
  minUsd: 1,
  minDays: 3,
  minRequests: 20,
  minErrors: 5,
};

export function computeTotals(lines: ProviderLine[]): CostTotals {
  const confirmed = lines.filter((l) => l.reportedUsd !== null);
  const estimated = lines.filter((l) => l.estimatedUsd !== null);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    confirmedUsd: confirmed.length ? sum(confirmed.map((l) => l.reportedUsd as number)) : null,
    confirmedProviders: confirmed.map((l) => l.provider),
    estimatedUsd: estimated.length ? sum(estimated.map((l) => l.estimatedUsd as number)) : null,
    estimatedProviders: estimated.map((l) => l.provider),
    estimateExcludes: lines.filter((l) => l.estimatedUsd === null).map((l) => l.provider),
  };
}

const PROVIDER_LABEL: Record<CostProvider, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  railway: "Railway",
  supabase: "Supabase",
};

export function providerLabel(p: CostProvider): string {
  return PROVIDER_LABEL[p];
}

const WHERE: Record<string, string> = {
  "total.confirmed": "desglose por proveedor abajo",
  "total.estimated": "desglose por proveedor abajo",
  "openai.estimated": "tabla ai_usage_events (provider=openai) y platform.openai.com/usage",
  "openai.reported": "platform.openai.com/usage",
  "openrouter.estimated": "tabla ai_usage_events (provider=openrouter) y openrouter.ai/activity",
  "openrouter.reported": "openrouter.ai/activity",
  "railway.estimated": "Railway → servicio worker → Metrics (CPU/RAM) y reinicios/deploys",
  "ai.requests": "ai_usage_events por operation/model; jobs de enriquecimiento y análisis",
  "ai.errors": "ai_usage_events.error_kind y logs ai-service del worker",
  "ai.retries": "ai_usage_events attempt>1 (pool de modelos / reintentos)",
};

interface MetricSpec {
  key: string;
  label: string;
  unit: "usd" | "count";
  get: (m: DayCostMetrics) => number | null;
}

function providerMetric(p: CostProvider, kind: "reported" | "estimated"): MetricSpec {
  return {
    key: `${p}.${kind}`,
    label: `${providerLabel(p)} ${kind === "reported" ? "reportado" : "estimado"}`,
    unit: "usd",
    get: (m) => {
      const line = m.providers.find((l) => l.provider === p);
      if (!line) return null;
      return kind === "reported" ? line.reportedUsd : line.estimatedUsd;
    },
  };
}

export const METRICS: MetricSpec[] = [
  { key: "total.confirmed", label: "Total confirmado", unit: "usd", get: (m) => m.totals.confirmedUsd },
  { key: "total.estimated", label: "Total estimado", unit: "usd", get: (m) => m.totals.estimatedUsd },
  providerMetric("openai", "estimated"),
  providerMetric("openrouter", "reported"),
  providerMetric("openrouter", "estimated"),
  providerMetric("railway", "estimated"),
  { key: "ai.requests", label: "Solicitudes IA", unit: "count", get: (m) => m.ai?.requests ?? null },
  { key: "ai.errors", label: "Errores IA", unit: "count", get: (m) => m.ai?.errors ?? null },
  { key: "ai.retries", label: "Reintentos IA", unit: "count", get: (m) => m.ai?.retries ?? null },
];

function minDelta(key: string, t: AnomalyThresholds): number {
  if (key === "ai.requests") return t.minRequests;
  if (key === "ai.errors" || key === "ai.retries") return t.minErrors;
  return t.minUsd;
}

/**
 * Compara el día contra el día previo y el promedio de los 7 previos.
 * `history` debe venir del más reciente al más antiguo (máximo 7 días).
 * Para que el total confirmado/estimado sea comparable, se exige que el
 * conjunto de proveedores incluidos sea el mismo que el del día actual.
 */
export function compareMetrics(
  current: DayCostMetrics,
  history: DayCostMetrics[],
  thresholds: AnomalyThresholds = DEFAULT_THRESHOLDS,
): MetricComparison[] {
  const out: MetricComparison[] = [];
  const prior = history.slice(0, 7);
  for (const spec of METRICS) {
    const value = spec.get(current);
    if (value === null) continue;
    const comparable = prior.filter((d) => sameComposition(spec.key, current, d));
    const values = comparable.map(spec.get).filter((v): v is number => v !== null);
    const prevDay = prior[0] && sameComposition(spec.key, current, prior[0]) ? spec.get(prior[0]) : null;
    const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

    let status: MetricComparison["status"] = "ok";
    if (values.length < thresholds.minDays || average === null) {
      status = "baseline";
    } else if (
      value > average * (1 + thresholds.pct / 100) &&
      value - average > minDelta(spec.key, thresholds)
    ) {
      status = "review";
    }

    out.push({
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      value,
      previous: prevDay,
      average,
      sampleDays: values.length,
      status,
      whereToCheck: WHERE[spec.key] ?? "",
    });
  }
  return out;
}

function sameComposition(key: string, a: DayCostMetrics, b: DayCostMetrics): boolean {
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((v) => y.includes(v));
  if (key === "total.confirmed") return same(a.totals.confirmedProviders, b.totals.confirmedProviders);
  if (key === "total.estimated") return same(a.totals.estimatedProviders, b.totals.estimatedProviders);
  return true;
}
