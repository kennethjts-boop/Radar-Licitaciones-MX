/**
 * Railway — sólo MÉTRICAS, sin costo.
 *
 * La consulta `usage` de la API pública GraphQL existe (changelog de Railway,
 * 2023-02-17), pero Railway no documenta oficialmente su esquema ni las
 * unidades de CPU_USAGE / MEMORY_USAGE_GB / NETWORK_TX_GB (verificado
 * 2026-10-24). Sin unidades acreditadas no se puede multiplicar por la tarifa
 * por minuto: el costo queda "no disponible" y Railway no entra en totales
 * monetarios ni en anomalías. Los valores se muestran tal como los devuelve
 * la API, sin unidad.
 */
import type { ProviderLine } from "../types";
import type { ProviderContext } from "./context";

const GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";
const MEASUREMENTS = ["CPU_USAGE", "MEMORY_USAGE_GB", "NETWORK_TX_GB"] as const;

const USAGE_QUERY = `query RadarCostUsage($projectId: String!, $startDate: DateTime!, $endDate: DateTime!) {
  usage(projectId: $projectId, startDate: $startDate, endDate: $endDate,
        measurements: [CPU_USAGE, MEMORY_USAGE_GB, NETWORK_TX_GB], groupBy: [SERVICE_ID]) {
    measurement
    value
    tags { serviceId }
  }
}`;

export const RAILWAY_COST_UNAVAILABLE =
  "Railway costo: no disponible (esquema y unidades de la consulta usage sin documentación oficial; no se convierte a USD)";

interface UsageEntry {
  measurement: string;
  value: number;
  tags?: { serviceId?: string | null };
}

/** Suma por medición del servicio; null si la API no devolvió nada para él. */
export function railwayServiceMetrics(entries: UsageEntry[], serviceId: string): Record<string, number> | null {
  const own = entries.filter((e) => e.tags?.serviceId === serviceId && Number.isFinite(e.value));
  if (!own.length) return null;
  const out: Record<string, number> = {};
  for (const m of MEASUREMENTS) {
    const values = own.filter((e) => e.measurement === m);
    if (values.length) out[m] = values.reduce((sum, e) => sum + e.value, 0);
  }
  return out;
}

export function formatRailwayMetrics(metrics: Record<string, number>): string {
  const parts = Object.entries(metrics).map(([k, v]) => `${k}=${Number(v.toFixed(3))}`);
  return `${parts.join(" · ")} (valores crudos de la API, sin unidad acreditada)`;
}

export async function collectRailway(ctx: ProviderContext): Promise<ProviderLine> {
  const line: ProviderLine = {
    provider: "railway",
    reportedUsd: null,
    estimatedUsd: null,
    missing: [RAILWAY_COST_UNAVAILABLE],
  };
  const token = ctx.env.RAILWAY_API_TOKEN?.trim();
  const projectId = ctx.env.RAILWAY_PROJECT_ID?.trim();
  const serviceId = ctx.env.RAILWAY_SERVICE_ID?.trim();

  if (!token) {
    line.missing.push("Railway métricas: RAILWAY_API_TOKEN no configurado (opcional; sólo para mostrar uso)");
    return line;
  }
  if (!projectId || !serviceId) {
    line.missing.push("Railway métricas: faltan RAILWAY_PROJECT_ID/RAILWAY_SERVICE_ID (Railway los inyecta en el servicio)");
    return line;
  }

  try {
    const res = await ctx.fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: USAGE_QUERY,
        variables: {
          projectId,
          startDate: ctx.startUtc.toISOString(),
          endDate: ctx.endUtc.toISOString(),
        },
      }),
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    if (!res.ok) {
      line.missing.push(`Railway métricas: API respondió HTTP ${res.status}`);
      return line;
    }
    const body = (await res.json()) as { data?: { usage?: UsageEntry[] }; errors?: unknown[] };
    if (body.errors?.length || !Array.isArray(body.data?.usage)) {
      line.missing.push("Railway métricas: la API devolvió error GraphQL o un esquema distinto al esperado");
      return line;
    }
    const metrics = railwayServiceMetrics(body.data.usage, serviceId);
    if (!metrics) {
      line.missing.push("Railway métricas: sin datos para el servicio en el periodo (posible retraso)");
      return line;
    }
    line.metricsDetail = formatRailwayMetrics(metrics);
  } catch (err) {
    line.missing.push(`Railway métricas: API no respondió (${err instanceof Error ? err.name : "error"})`);
  }
  return line;
}
