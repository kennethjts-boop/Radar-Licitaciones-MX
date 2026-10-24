/**
 * Vista previa del reporte diario de gastos con datos FICTICIOS.
 * No consulta proveedores, no escribe en DB y no envía a Telegram.
 *   npm run cost-report:preview
 */
import { compareMetrics, computeTotals, DEFAULT_THRESHOLDS } from "../modules/cost-report/analysis";
import { formatCostReport } from "../modules/cost-report/format";
import { mexicoDayBounds, previousDates } from "../modules/cost-report/period";
import { RAILWAY_COST_UNAVAILABLE } from "../modules/cost-report/providers/railway";
import { supabaseLine } from "../modules/cost-report/providers/supabase";
import type { DayCostMetrics, ProviderLine } from "../modules/cost-report/types";

function fakeDay(date: string, openai: number, requests: number, errors: number, retries: number): DayCostMetrics {
  const providers: ProviderLine[] = [
    {
      provider: "openai",
      reportedUsd: null,
      estimatedUsd: openai,
      estimateDetail: "registro Radar × tarifa pública",
      missing: ["OpenAI gasto real: falta OPENAI_ADMIN_KEY (Admin key de la organización con alcance de lectura de Usage; la clave de inferencia no sirve)"],
    },
    {
      provider: "openrouter",
      reportedUsd: null,
      estimatedUsd: 0.0021,
      estimateDetail: "registro Radar, costo por solicitud",
      reference: { usd: 0.0023, period: "23/10 00:00:02 → 24/10 00:00:03 CDMX (contador de la clave)", reason: "clave no declarada exclusiva de Radar (OPENROUTER_KEY_DEDICATED)" },
      missing: [],
    },
    {
      provider: "railway",
      reportedUsd: null,
      estimatedUsd: null,
      metricsDetail: "CPU_USAGE=412 · MEMORY_USAGE_GB=1310 · NETWORK_TX_GB=0.84 (valores crudos de la API, sin unidad acreditada)",
      missing: [RAILWAY_COST_UNAVAILABLE],
    },
    supabaseLine(),
  ];
  const b = mexicoDayBounds(date);
  return {
    date,
    periodStartUtc: b.startUtc.toISOString(),
    periodEndUtc: b.endUtc.toISOString(),
    providers,
    ai: {
      requests,
      errors,
      retries,
      inputTokens: requests * 3900,
      outputTokens: requests * 310,
      unpricedRequests: 0,
      unverifiedPricingModels: [],
      errorKinds: errors ? { http_429: errors - 1, timeout: 1 } : {},
      byModel: [
        { provider: "openai", model: "gpt-4.1-mini", requests: requests - 6, errors: errors, inputTokens: (requests - 6) * 3900, outputTokens: (requests - 6) * 310, estimatedUsd: openai - 0.01, reportedUsd: null },
        { provider: "openai", model: "text-embedding-3-small", requests: 4, errors: 0, inputTokens: 18_000, outputTokens: 0, estimatedUsd: 0.01, reportedUsd: null },
        { provider: "openrouter", model: "openai/gpt-4o-mini", requests: 2, errors: 0, inputTokens: 1_400, outputTokens: 260, estimatedUsd: 0.0021, reportedUsd: 0.0021 },
      ],
    },
    totals: computeTotals(providers),
  };
}

const date = "2026-10-23";
const history = previousDates(date, 7).map((d, i) => fakeDay(d, 0.6 + (i % 3) * 0.05, 140 + i * 3, 2, 3));
const current = fakeDay(date, 2.35, 520, 31, 44);
const text = formatCostReport(current, compareMetrics(current, history, DEFAULT_THRESHOLDS), {
  generatedAt: new Date("2026-10-24T14:00:04Z"),
  thresholds: DEFAULT_THRESHOLDS,
});
console.log(text);
