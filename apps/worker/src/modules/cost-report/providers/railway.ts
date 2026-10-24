/**
 * Railway — ESTIMACIÓN con la consulta `usage` de la API pública GraphQL
 * (uso agregado del proyecto en [startDate, endDate), agrupado por servicio)
 * × tarifas públicas por minuto. No es la factura: no descuenta créditos
 * incluidos del plan ni suscripción. Railway no expone el monto facturado
 * por día en su API pública.
 *
 * Unidades asumidas (validar contra la factura la primera semana):
 * CPU_USAGE = vCPU·minuto, MEMORY_USAGE_GB = GB·minuto, NETWORK_TX_GB = GB.
 */
import { RAILWAY_PRICES } from "../pricing";
import type { ProviderLine } from "../types";
import type { ProviderContext } from "./context";

const GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";

const USAGE_QUERY = `query RadarCostUsage($projectId: String!, $startDate: DateTime!, $endDate: DateTime!) {
  usage(projectId: $projectId, startDate: $startDate, endDate: $endDate,
        measurements: [CPU_USAGE, MEMORY_USAGE_GB, NETWORK_TX_GB], groupBy: [SERVICE_ID]) {
    measurement
    value
    tags { serviceId }
  }
}`;

interface UsageEntry {
  measurement: string;
  value: number;
  tags?: { serviceId?: string | null };
}

export function estimateRailwayCost(entries: UsageEntry[], serviceId: string) {
  const pick = (m: string) =>
    entries
      .filter((e) => e.measurement === m && e.tags?.serviceId === serviceId)
      .reduce((sum, e) => sum + (Number.isFinite(e.value) ? e.value : 0), 0);
  const cpu = pick("CPU_USAGE");
  const mem = pick("MEMORY_USAGE_GB");
  const egress = pick("NETWORK_TX_GB");
  const usd =
    cpu * RAILWAY_PRICES.vcpuMinuteUsd +
    mem * RAILWAY_PRICES.memoryGbMinuteUsd +
    egress * RAILWAY_PRICES.egressGbUsd;
  const found = entries.some((e) => e.tags?.serviceId === serviceId);
  return { usd, cpu, mem, egress, found };
}

export async function collectRailway(ctx: ProviderContext): Promise<ProviderLine> {
  const line: ProviderLine = { provider: "railway", reportedUsd: null, estimatedUsd: null, missing: [] };
  const token = ctx.env.RAILWAY_API_TOKEN?.trim();
  const projectId = ctx.env.RAILWAY_PROJECT_ID?.trim();
  const serviceId = ctx.env.RAILWAY_SERVICE_ID?.trim();

  if (!token) {
    line.missing.push(
      "Railway: falta RAILWAY_API_TOKEN (token de workspace del equipo dueño del proyecto; se envía como Bearer)",
    );
    return line;
  }
  if (!projectId || !serviceId) {
    line.missing.push("Railway: faltan RAILWAY_PROJECT_ID/RAILWAY_SERVICE_ID (Railway los inyecta en el servicio)");
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
      line.missing.push(`Railway API respondió HTTP ${res.status}`);
      return line;
    }
    const body = (await res.json()) as { data?: { usage?: UsageEntry[] }; errors?: Array<{ message?: string }> };
    if (body.errors?.length || !body.data?.usage) {
      line.missing.push("Railway API devolvió error GraphQL (revisar permisos del token)");
      return line;
    }
    const est = estimateRailwayCost(body.data.usage, serviceId);
    if (!est.found) {
      line.missing.push("Railway: sin uso registrado para el servicio en el periodo (posible retraso)");
      return line;
    }
    line.estimatedUsd = est.usd;
    line.estimateDetail = `CPU ${est.cpu.toFixed(1)} vCPU·min · RAM ${est.mem.toFixed(0)} GB·min · salida ${est.egress.toFixed(2)} GB`;
  } catch (err) {
    line.missing.push(`Railway API no respondió (${err instanceof Error ? err.name : "error"})`);
  }
  return line;
}
