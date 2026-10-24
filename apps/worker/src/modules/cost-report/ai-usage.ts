/**
 * Registro mínimo de consumo de IA (tabla ai_usage_events).
 * Nunca lanza: un fallo aquí no debe afectar análisis ni recolección.
 * Nunca guarda prompts, respuestas, mensajes de error ni claves.
 */
import { createModuleLogger } from "../../core/logger";
import { getSupabaseClient } from "../../storage/client";
import { estimateTokenCost } from "./pricing";
import type { AiModelStats, AiStats } from "./types";

const log = createModuleLogger("cost-report:ai-usage");
const TABLE = "ai_usage_events";
const WARN_THROTTLE_MS = 60 * 60 * 1000;
let lastWarnAt = 0;

export type AiProvider = "openai" | "openrouter";

export interface AiUsageInput {
  provider: AiProvider;
  model: string;
  operation: string;
  status: "ok" | "error";
  attempt?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reportedCostUsd?: number | null;
  errorKind?: string | null;
}

interface UsageLike {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  cost?: unknown;
}

export type UsageKind = "chat" | "embedding";

/**
 * Extrae tokens y costo (OpenRouter `usage.cost`) de una respuesta.
 * Embeddings: `usage` trae prompt_tokens/total_tokens y no completion_tokens;
 * la salida es 0 por definición y la entrada cae a total_tokens si falta
 * prompt_tokens. En chat, la ausencia de completion_tokens queda como null.
 */
export function usageFromResponse(
  response: unknown,
  kind: UsageKind = "chat",
): {
  inputTokens: number | null;
  outputTokens: number | null;
  reportedCostUsd: number | null;
} {
  const usage = (response as { usage?: UsageLike } | null)?.usage;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const prompt = num(usage?.prompt_tokens);
  const completion = num(usage?.completion_tokens);
  const total = num(usage?.total_tokens);

  let inputTokens = prompt;
  let outputTokens = completion;
  if (kind === "embedding") {
    inputTokens = prompt ?? total;
    outputTokens = inputTokens !== null ? (completion ?? 0) : null;
  } else if (inputTokens === null && total !== null && completion !== null) {
    inputTokens = Math.max(0, total - completion);
  }
  return { inputTokens, outputTokens, reportedCostUsd: num(usage?.cost) };
}

/** Clasificación corta del error, sin texto libre. */
export function classifyAiError(err: unknown): string {
  const e = err as { status?: unknown; name?: unknown; code?: unknown } | null;
  if (typeof e?.status === "number") return `http_${e.status}`;
  if (e?.name === "AbortError" || /timeout/i.test(String(e?.name ?? ""))) return "timeout";
  const message = err instanceof Error ? err.message : String(err);
  if (/timed? ?out/i.test(message)) return "timeout";
  if (/JSON/i.test(message)) return "parse_error";
  if (/vac[ií]a|empty/i.test(message)) return "empty_response";
  if (/fetch failed|ECONN|ENOTFOUND|network|socket/i.test(message)) return "network";
  return "unknown";
}

export function buildUsageRow(input: AiUsageInput, occurredAt = new Date()) {
  const inputTokens = input.inputTokens ?? null;
  const outputTokens = input.outputTokens ?? null;
  const estimate =
    inputTokens === null && outputTokens === null
      ? null
      : estimateTokenCost(input.model, inputTokens ?? 0, outputTokens ?? 0).usd;
  return {
    occurred_at: occurredAt.toISOString(),
    provider: input.provider,
    model: input.model.slice(0, 120),
    operation: input.operation.slice(0, 60),
    status: input.status,
    attempt: Math.max(1, Math.trunc(input.attempt ?? 1)),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_reported_usd: input.reportedCostUsd ?? null,
    cost_estimated_usd: estimate,
    error_kind: input.errorKind ? input.errorKind.slice(0, 40) : null,
  };
}

export function recordAiUsage(input: AiUsageInput): void {
  if (process.env.NODE_ENV === "test") return;
  try {
    const row = buildUsageRow(input);
    void Promise.resolve(getSupabaseClient().from(TABLE).insert(row))
      .then(({ error }) => {
        if (error) warnThrottled(error.message);
      })
      .catch((err: unknown) => warnThrottled(String(err)));
  } catch (err) {
    warnThrottled(String(err));
  }
}

function warnThrottled(reason: string): void {
  const now = Date.now();
  if (now - lastWarnAt < WARN_THROTTLE_MS) return;
  lastWarnAt = now;
  log.warn({ reason: reason.slice(0, 200) }, "No se pudo registrar consumo de IA (¿migración pendiente?)");
}

/** Ejecuta una llamada de IA y registra su consumo; propaga el error original. */
export async function trackAiCall<T>(
  meta: Omit<AiUsageInput, "status" | "inputTokens" | "outputTokens" | "reportedCostUsd" | "errorKind"> & {
    usageKind?: UsageKind;
  },
  call: () => Promise<T>,
): Promise<T> {
  const { usageKind = "chat", ...base } = meta;
  try {
    const response = await call();
    recordAiUsage({ ...base, status: "ok", ...usageFromResponse(response, usageKind) });
    return response;
  } catch (err) {
    recordAiUsage({ ...base, status: "error", errorKind: classifyAiError(err) });
    throw err;
  }
}

// ─── Agregación ─────────────────────────────────────────────────────────────

export interface AiUsageRow {
  provider: AiProvider;
  model: string;
  status: "ok" | "error";
  attempt: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_reported_usd: number | string | null;
  cost_estimated_usd: number | string | null;
  error_kind: string | null;
}

const toNum = (v: number | string | null): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function aggregateAiUsage(rows: AiUsageRow[]): AiStats {
  const byKey = new Map<string, AiModelStats>();
  const errorKinds: Record<string, number> = {};
  const unverified = new Set<string>();
  const stats: AiStats = {
    requests: 0,
    errors: 0,
    retries: 0,
    inputTokens: 0,
    outputTokens: 0,
    unpricedRequests: 0,
    unverifiedPricingModels: [],
    errorKinds,
    byModel: [],
  };

  for (const row of rows) {
    const key = `${row.provider}|${row.model}`;
    let m = byKey.get(key);
    if (!m) {
      m = {
        provider: row.provider,
        model: row.model,
        requests: 0,
        errors: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedUsd: null,
        reportedUsd: null,
      };
      byKey.set(key, m);
    }
    const input = row.input_tokens ?? 0;
    const output = row.output_tokens ?? 0;
    stats.requests += 1;
    m.requests += 1;
    stats.inputTokens += input;
    stats.outputTokens += output;
    m.inputTokens += input;
    m.outputTokens += output;
    if (row.attempt > 1) stats.retries += 1;
    if (row.status === "error") {
      stats.errors += 1;
      m.errors += 1;
      const kind = row.error_kind ?? "unknown";
      errorKinds[kind] = (errorKinds[kind] ?? 0) + 1;
    }

    const reported = toNum(row.cost_reported_usd);
    if (reported !== null) m.reportedUsd = (m.reportedUsd ?? 0) + reported;

    // Estimación: costo informado en la respuesta si existe; si no, tarifa.
    // Errores sin tokens no generan costo estimable (no se cuentan como $0).
    const estimated = reported ?? toNum(row.cost_estimated_usd);
    if (estimated !== null) {
      m.estimatedUsd = (m.estimatedUsd ?? 0) + estimated;
    } else if (row.status === "ok") {
      stats.unpricedRequests += 1;
    }
    if (reported === null && row.status === "ok") {
      const price = estimateTokenCost(row.model, 0, 0);
      if (price.usd !== null && !price.verified) unverified.add(row.model);
    }
  }

  stats.byModel = [...byKey.values()].sort(
    (a, b) => (b.estimatedUsd ?? 0) - (a.estimatedUsd ?? 0) || b.requests - a.requests,
  );
  stats.unverifiedPricingModels = [...unverified].sort();
  return stats;
}

/** Lee eventos del intervalo [start, end) en páginas; consulta ligera indexada. */
export async function fetchAiUsageRows(start: Date, end: Date, maxRows = 50_000): Promise<AiUsageRow[]> {
  const db = getSupabaseClient();
  const pageSize = 1000;
  const rows: AiUsageRow[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await db
      .from(TABLE)
      .select("provider,model,status,attempt,input_tokens,output_tokens,cost_reported_usd,cost_estimated_usd,error_kind")
      .gte("occurred_at", start.toISOString())
      .lt("occurred_at", end.toISOString())
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`ai_usage_events: ${error.message}`);
    rows.push(...((data ?? []) as AiUsageRow[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}
