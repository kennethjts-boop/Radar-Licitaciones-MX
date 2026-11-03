/**
 * Vista previa del reporte diario de gastos con datos FICTICIOS.
 * No consulta proveedores, no escribe en DB y no envía a Telegram.
 *   npm run cost-report:preview                # día con cobertura completa
 *   npm run cost-report:preview -- parcial     # día de instalación
 *   npm run cost-report:preview -- sin-datos   # día anterior a la medición
 */
import { compareMetrics, computeTotals, DEFAULT_THRESHOLDS } from "../modules/cost-report/analysis";
import { formatCostReport } from "../modules/cost-report/format";
import { mexicoDayBounds, previousDates } from "../modules/cost-report/period";
import { classifyCoverage, coverageNote } from "../modules/cost-report/coverage";
import { RAILWAY_COST_UNAVAILABLE } from "../modules/cost-report/providers/railway";
import { supabaseLine } from "../modules/cost-report/providers/supabase";
import type { DayCostMetrics, DayCoverage, ProviderLine } from "../modules/cost-report/types";

function fakeDay(
  date: string,
  openai: number,
  requests: number,
  errors: number,
  retries: number,
  coverage: DayCoverage = { status: "complete", since: "2026-10-01T00:00:00.000Z", droppedEvents: 0 },
): DayCostMetrics {
  const aiCoverage = { status: coverage.status, note: coverageNote(coverage) } as const;
  const none = coverage.status === "none";
  const providers: ProviderLine[] = [
    {
      provider: "openai",
      reportedUsd: null,
      estimatedUsd: none ? null : openai,
      estimateDetail: none ? undefined : "registro Radar × tarifa pública",
      coverage: aiCoverage,
      missing: ["OpenAI gasto real y contraste: falta OPENAI_ADMIN_KEY (Admin key de la organización, la crea un Owner; el worker sólo lee /organization/usage y /organization/costs)"],
    },
    {
      provider: "openrouter",
      reportedUsd: null,
      estimatedUsd: none ? null : 0.0021,
      estimateDetail: none ? undefined : "registro Radar, costo por solicitud",
      coverage: aiCoverage,
      reconciliation: none
        ? undefined
        : "contador sha256:3f1c9a0b7d2e4c51 23/10 00:00:02 → 24/10 00:00:03 CDMX: US$0.0023 · respuestas Radar misma clave y periodo: US$0.0021 (2 sol) · diferencia US$0.0002",
      reference: { usd: 0.0023, period: "23/10 00:00:02 → 24/10 00:00:03 CDMX (contador de la clave)", reason: "clave no declarada exclusiva de Radar (OPENROUTER_KEY_DEDICATED)" },
      missing: [],
    },
    {
      provider: "railway",
      reportedUsd: null,
      estimatedUsd: null,
      metricsDetail: "CPU_USAGE=412 · MEMORY_USAGE_GB=1310 · NETWORK_TX_GB=0.84 (valores crudos de la API, sin unidad acreditada)",
      coverage: { status: "not_applicable" },
      missing: [RAILWAY_COST_UNAVAILABLE],
    },
    supabaseLine("micro"),
  ];
  const b = mexicoDayBounds(date);
  return {
    date,
    periodStartUtc: b.startUtc.toISOString(),
    periodEndUtc: b.endUtc.toISOString(),
    providers,
    coverage,
    ai: none ? null : {
      requests,
      errors,
      retries,
      httpRetries: 3,
      retriesUnobserved: 0,
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

const scenario = process.argv[2] ?? "completa";
// "sin-datos": el 22/10 terminó antes de la instalación (23/10 19:46 CDMX).
const date = scenario === "sin-datos" ? "2026-10-22" : "2026-10-23";
const since =
  scenario === "sin-datos" ? "2026-10-24T01:46:00.000Z" : scenario === "parcial" ? "2026-10-23T19:46:00.000Z" : "2026-10-01T00:00:00.000Z";
const marker = { since, version: 2 };
const history = previousDates(date, 7).map((d, i) =>
  fakeDay(d, 0.6 + (i % 3) * 0.05, 140 + i * 3, 2, 3, classifyCoverage(d, marker, null)),
);
const current = fakeDay(date, 2.35, 520, 31, 44, classifyCoverage(date, marker, null));
const text = formatCostReport(current, compareMetrics(current, history, DEFAULT_THRESHOLDS), {
  generatedAt: new Date("2026-10-24T14:00:04Z"),
  thresholds: DEFAULT_THRESHOLDS,
});
console.log(text);
