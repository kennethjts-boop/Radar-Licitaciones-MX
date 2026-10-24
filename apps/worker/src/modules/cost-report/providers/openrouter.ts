/**
 * OpenRouter — gasto real vía GET /api/v1/key (contador acumulado `usage`, en
 * USD, de la clave usada por Radar). `usage_daily` es día UTC, así que se
 * toma un corte del contador al inicio de cada día MX y el gasto es la
 * diferencia entre dos cortes de la MISMA clave.
 *
 * - Cada corte guarda su hora real (capturedAt) y una huella no secreta de
 *   la clave (sha256 truncado). Cortes de claves distintas no se comparan.
 * - Sólo si ambos cortes caen dentro de SNAPSHOT_ALIGNED_MAX_SEC tras las
 *   00:00 MX la diferencia representa el día MX; si no, se informa como
 *   referencia con el periodo real que cubre.
 * - Cuenta como gasto de Radar sólo con OPENROUTER_KEY_DEDICATED=true.
 */
import { createHash } from "crypto";
import { formatInTimeZone } from "date-fns-tz";
import { MX_TIMEZONE } from "../../../core/time";
import { mexicoDayBounds, shiftDate } from "../period";
import type { ProviderLine } from "../types";
import type { ProviderContext } from "./context";

const KEY_URL = "https://openrouter.ai/api/v1/key";
/** Tolerancia para considerar que un corte marca el límite del día MX. */
export const SNAPSHOT_ALIGNED_MAX_SEC = 60;

export interface OpenRouterSnapshot {
  usageUsd: number;
  /** Instante real del corte (ISO UTC). */
  capturedAt: string;
  /** Huella no secreta de la clave: "sha256:" + 16 hex. */
  keyId: string;
}

export function openRouterKeyId(apiKey: string): string {
  return `sha256:${createHash("sha256").update(apiKey.trim()).digest("hex").slice(0, 16)}`;
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

export interface OpenRouterDelta {
  usd: number | null;
  /** true sólo si ambos cortes marcan los límites 00:00 MX del día. */
  aligned: boolean;
  periodStart?: string;
  periodEnd?: string;
  problem?: string;
}

/**
 * Diferencia entre el corte del inicio de `date` y el del día siguiente.
 * Rechaza cortes faltantes, de claves distintas o contadores que bajan.
 */
export function openRouterDayDelta(
  date: string,
  start: OpenRouterSnapshot | null,
  end: OpenRouterSnapshot | null,
): OpenRouterDelta {
  if (!start || !end) {
    return { usd: null, aligned: false, problem: `falta corte del contador (${!start ? "inicio" : "fin"} del día)` };
  }
  if (!start.keyId || !end.keyId || start.keyId !== end.keyId) {
    return { usd: null, aligned: false, problem: "los cortes pertenecen a claves distintas o sin identificar; no se comparan" };
  }
  const startAt = new Date(start.capturedAt);
  const endAt = new Date(end.capturedAt);
  if (!(endAt.getTime() > startAt.getTime())) {
    return { usd: null, aligned: false, problem: "cortes con fechas inválidas" };
  }
  const delta = end.usageUsd - start.usageUsd;
  if (delta < 0) return { usd: null, aligned: false, problem: "el contador bajó entre cortes" };

  const bounds = mexicoDayBounds(date);
  const offsetSec = (at: Date, boundary: Date) => (at.getTime() - boundary.getTime()) / 1000;
  const within = (sec: number) => sec >= 0 && sec <= SNAPSHOT_ALIGNED_MAX_SEC;
  return {
    usd: delta,
    aligned: within(offsetSec(startAt, bounds.startUtc)) && within(offsetSec(endAt, bounds.endUtc)),
    periodStart: start.capturedAt,
    periodEnd: end.capturedAt,
  };
}

/** Claves de los dos cortes que delimitan `date`. */
export function snapshotDatesFor(date: string): [string, string] {
  return [date, shiftDate(date, 1)];
}

const mx = (iso: string) => formatInTimeZone(new Date(iso), MX_TIMEZONE, "dd/MM HH:mm:ss");

export function buildOpenRouterLine(
  ctx: Pick<ProviderContext, "env">,
  delta: OpenRouterDelta | null,
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
  if (delta.aligned && ctx.env.OPENROUTER_KEY_DEDICATED) {
    line.reportedUsd = delta.usd;
    return line;
  }
  const reasons: string[] = [];
  if (!delta.aligned) reasons.push("no cubre exactamente el día MX (corte fuera de 00:00)");
  if (!ctx.env.OPENROUTER_KEY_DEDICATED) reasons.push("clave no declarada exclusiva de Radar (OPENROUTER_KEY_DEDICATED)");
  line.reference = {
    usd: delta.usd,
    period: `${mx(delta.periodStart as string)} → ${mx(delta.periodEnd as string)} CDMX (contador de la clave)`,
    reason: reasons.join("; "),
  };
  if (!delta.aligned) line.missing.push("OpenRouter gasto real: corte de medianoche tomado tarde; se muestra como referencia");
  return line;
}
