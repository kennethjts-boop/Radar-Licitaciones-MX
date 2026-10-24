/**
 * OpenRouter — gasto real vía GET /api/v1/key (contador acumulado `usage`, en
 * USD, de la clave usada por Radar). `usage_daily` es día UTC, así que se
 * toma un corte del contador a las 00:00 MX y el gasto del día MX es la
 * diferencia entre dos cortes consecutivos.
 *
 * Sólo cuenta como gasto de Radar si OPENROUTER_KEY_DEDICATED=true (la clave
 * no se comparte con otros proyectos); si no, se muestra como referencia.
 */
import type { ProviderLine } from "../types";
import type { ProviderContext } from "./context";

const KEY_URL = "https://openrouter.ai/api/v1/key";
/** Un corte tomado después de las 00:20 MX ya no representa la medianoche. */
export const SNAPSHOT_MAX_DELAY_MIN = 20;

export interface OpenRouterSnapshot {
  usageUsd: number;
  capturedAt: string;
  /** Minutos transcurridos desde las 00:00 MX al capturar. */
  delayMinutes: number;
}

export async function fetchOpenRouterUsage(
  apiKey: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<number> {
  const res = await fetchImpl(KEY_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`OpenRouter /key HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { usage?: unknown } };
  const usage = body.data?.usage;
  if (typeof usage !== "number" || !Number.isFinite(usage)) {
    throw new Error("OpenRouter /key sin campo usage numérico");
  }
  return usage;
}

export function openRouterDayDelta(
  start: OpenRouterSnapshot | null,
  end: OpenRouterSnapshot | null,
): { usd: number | null; problem?: string } {
  if (!start || !end) {
    return { usd: null, problem: `falta corte de medianoche (${!start ? "inicio" : "fin"} del día)` };
  }
  if (start.delayMinutes > SNAPSHOT_MAX_DELAY_MIN || end.delayMinutes > SNAPSHOT_MAX_DELAY_MIN) {
    return { usd: null, problem: "corte de medianoche tomado tarde (reinicio del worker)" };
  }
  const delta = end.usageUsd - start.usageUsd;
  if (delta < 0) return { usd: null, problem: "el contador bajó (¿cambio de clave?)" };
  return { usd: delta };
}

export function buildOpenRouterLine(
  ctx: Pick<ProviderContext, "env">,
  delta: { usd: number | null; problem?: string } | null,
  aiEstimatedUsd: number | null,
): ProviderLine {
  const line: ProviderLine = {
    provider: "openrouter",
    reportedUsd: null,
    estimatedUsd: aiEstimatedUsd,
    estimateDetail: aiEstimatedUsd !== null ? "registro Radar, costo por solicitud" : undefined,
    missing: [],
  };
  if (!ctx.env.OPENROUTER_API_KEY?.trim()) {
    line.missing.push("OpenRouter: OPENROUTER_API_KEY no configurada en el worker");
    return line;
  }
  if (!delta || delta.usd === null) {
    line.missing.push(`OpenRouter gasto real: ${delta?.problem ?? "sin cortes del contador"}`);
    return line;
  }
  if (ctx.env.OPENROUTER_KEY_DEDICATED) {
    line.reportedUsd = delta.usd;
  } else {
    line.reference = {
      usd: delta.usd,
      period: "día MX (contador de la clave)",
      reason: "clave no declarada exclusiva de Radar (OPENROUTER_KEY_DEDICATED)",
    };
  }
  return line;
}
