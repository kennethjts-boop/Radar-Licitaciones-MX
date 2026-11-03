/**
 * Registro mínimo de consumo de IA (tabla ai_usage_events).
 * Nunca lanza: un fallo aquí no debe afectar análisis ni recolección.
 * Nunca guarda prompts, respuestas, mensajes de error ni claves (sólo una
 * huella sha256 truncada de la clave usada).
 *
 * Una fila = una solicitud observada por Radar. `http_attempts` cuenta los
 * intentos HTTP que hizo el SDK de OpenAI para esa solicitud (1 = sin
 * reintentos internos); NULL = no observable.
 * Si el INSERT falla, la fila se reintenta en memoria; si se agota o se
 * descarta, se anota el hueco del día en system_state (cobertura parcial).
 */
import { AsyncLocalStorage } from "async_hooks";
import { createHash } from "crypto";
import { createModuleLogger } from "../../core/logger";
import { getSupabaseClient } from "../../storage/client";
import { gapKey, type GapRecord } from "./coverage";
import { mexicoDateOf } from "./period";
import { estimateTokenCost } from "./pricing";
import { supabaseStateStore } from "./report-state";
import type { AiModelStats, AiStats } from "./types";

const log = createModuleLogger("cost-report:ai-usage");
const TABLE = "ai_usage_events";
const WARN_THROTTLE_MS = 60 * 60 * 1000;
let lastWarnAt = 0;

/** Huella no secreta de una clave: "sha256:" + 16 hex. */
export function keyFingerprint(apiKey: string): string {
  return `sha256:${createHash("sha256").update(apiKey.trim()).digest("hex").slice(0, 16)}`;
}

// ─── Intentos HTTP del SDK ──────────────────────────────────────────────────

const attemptScope = new AsyncLocalStorage<{ attempts: number }>();

/**
 * `fetch` para clientes OpenAI: cuenta cada intento HTTP de la solicitud en
 * curso (incluye reintentos internos del SDK) sin modificar la petición.
 */
export const observedFetch: typeof fetch = (input, init) => {
  const scope = attemptScope.getStore();
  if (scope) scope.attempts += 1;
  return fetch(input, init);
};

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
  /** Intentos HTTP observados; null = no observable. */
  httpAttempts?: number | null;
  /** Huella de la clave (keyFingerprint), nunca la clave. */
  keyId?: string | null;
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
    http_attempts:
      typeof input.httpAttempts === "number" && input.httpAttempts >= 1 ? Math.trunc(input.httpAttempts) : null,
    key_id: input.keyId ? input.keyId.slice(0, 24) : null,
  };
}

export type UsageRow = ReturnType<typeof buildUsageRow>;

// ─── Envío con reintento y registro de huecos ───────────────────────────────

/** Columnas añadidas en 20261025_ai_usage_coverage.sql; se omiten si faltan. */
const OPTIONAL_COLUMNS = ["http_attempts", "key_id"] as const;

export function isMissingOptionalColumn(error: { code?: string; message?: string }): boolean {
  const msg = error.message ?? "";
  return (error.code === "PGRST204" || error.code === "42703" || /column/i.test(msg)) &&
    OPTIONAL_COLUMNS.some((c) => msg.includes(c));
}

export interface RecorderDeps {
  /** Inserta filas; devuelve el error (texto) o null. */
  insert: (rows: UsageRow[]) => Promise<string | null>;
  /** Suma eventos perdidos al hueco de un día MX. */
  addGap: (date: string, dropped: number) => Promise<void>;
  schedule?: (fn: () => void, ms: number) => void;
  maxPending?: number;
  maxTries?: number;
  flushMs?: number;
}

export function createUsageRecorder(deps: RecorderDeps) {
  const maxPending = deps.maxPending ?? 500;
  const maxTries = deps.maxTries ?? 30;
  const flushMs = deps.flushMs ?? 60_000;
  const schedule = deps.schedule ?? ((fn, ms) => void setTimeout(fn, ms).unref());
  const pending: Array<{ row: UsageRow; tries: number }> = [];
  const dropped = new Map<string, number>();
  let scheduled = false;
  let flushing = false;

  const drop = (row: UsageRow) => {
    const date = mexicoDateOf(new Date(row.occurred_at));
    dropped.set(date, (dropped.get(date) ?? 0) + 1);
  };
  const enqueue = (row: UsageRow, tries: number) => {
    pending.push({ row, tries });
    while (pending.length > maxPending) drop(pending.shift()!.row);
  };
  const later = () => {
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      void flush();
    }, flushMs);
  };

  async function persistGaps(): Promise<void> {
    for (const [date, n] of [...dropped]) {
      try {
        await deps.addGap(date, n);
        dropped.set(date, (dropped.get(date) ?? n) - n);
        if (!dropped.get(date)) dropped.delete(date);
      } catch (err) {
        warnThrottled(String(err));
      }
    }
  }

  async function flush(): Promise<void> {
    if (flushing) return;
    flushing = true;
    try {
      const batch = pending.splice(0, pending.length);
      if (batch.length) {
        const error = await deps.insert(batch.map((b) => b.row)).catch((e: unknown) => String(e));
        if (error) {
          warnThrottled(error);
          for (const b of batch) {
            if (b.tries + 1 >= maxTries) drop(b.row);
            else enqueue(b.row, b.tries + 1);
          }
        }
      }
      if (dropped.size) await persistGaps();
    } finally {
      flushing = false;
      if (pending.length || dropped.size) later();
    }
  }

  async function record(row: UsageRow): Promise<void> {
    const error = await deps.insert([row]).catch((e: unknown) => String(e));
    if (error) {
      warnThrottled(error);
      enqueue(row, 1);
      later();
    } else if (pending.length || dropped.size) {
      void flush();
    }
  }

  return { record, flush, pendingCount: () => pending.length, droppedByDate: () => new Map(dropped) };
}

let legacySchema = false;

async function supabaseInsert(rows: UsageRow[]): Promise<string | null> {
  const strip = (r: UsageRow) => {
    if (!legacySchema) return r;
    const { http_attempts: _a, key_id: _k, ...rest } = r;
    return rest;
  };
  let { error } = await getSupabaseClient().from(TABLE).insert(rows.map(strip));
  if (error && !legacySchema && isMissingOptionalColumn(error)) {
    legacySchema = true;
    log.warn("ai_usage_events sin columnas http_attempts/key_id (migración pendiente): se registran sin ellas");
    ({ error } = await getSupabaseClient().from(TABLE).insert(rows.map(strip)));
  }
  return error ? error.message : null;
}

async function supabaseAddGap(date: string, droppedEvents: number): Promise<void> {
  const store = supabaseStateStore();
  const prev = await store.read<GapRecord>(gapKey(date));
  const value: GapRecord = {
    droppedEvents: (prev?.droppedEvents ?? 0) + droppedEvents,
    updatedAt: new Date().toISOString(),
  };
  await store.write(gapKey(date), value);
}

let defaultRecorder: ReturnType<typeof createUsageRecorder> | null = null;
let testSink: ((input: AiUsageInput) => void) | null = null;

/** Sólo pruebas: captura los registros en lugar de escribir en la DB. */
export function setAiUsageSinkForTests(sink: ((input: AiUsageInput) => void) | null): void {
  testSink = sink;
}

export function recordAiUsage(input: AiUsageInput): void {
  if (testSink) return testSink(input);
  if (process.env.NODE_ENV === "test") return;
  try {
    defaultRecorder ??= createUsageRecorder({ insert: supabaseInsert, addGap: supabaseAddGap });
    void defaultRecorder.record(buildUsageRow(input)).catch((err: unknown) => warnThrottled(String(err)));
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

/**
 * Ejecuta una llamada de IA y registra su consumo; propaga el error original.
 * Si el cliente usa `observedFetch`, registra los intentos HTTP reales; si
 * no, http_attempts queda NULL (reintentos internos no medibles).
 */
export async function trackAiCall<T>(
  meta: Omit<
    AiUsageInput,
    "status" | "inputTokens" | "outputTokens" | "reportedCostUsd" | "errorKind" | "httpAttempts"
  > & {
    usageKind?: UsageKind;
  },
  call: () => Promise<T>,
): Promise<T> {
  const { usageKind = "chat", ...base } = meta;
  const scope = { attempts: 0 };
  const httpAttempts = () => (scope.attempts > 0 ? scope.attempts : null);
  try {
    const response = await attemptScope.run(scope, call);
    recordAiUsage({ ...base, status: "ok", httpAttempts: httpAttempts(), ...usageFromResponse(response, usageKind) });
    return response;
  } catch (err) {
    recordAiUsage({ ...base, status: "error", httpAttempts: httpAttempts(), errorKind: classifyAiError(err) });
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
  occurred_at?: string;
  /** Ausente/NULL: filas anteriores a la migración o sin observación HTTP. */
  http_attempts?: number | null;
  key_id?: string | null;
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
    httpRetries: 0,
    retriesUnobserved: 0,
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
    if (typeof row.http_attempts === "number") stats.httpRetries += Math.max(0, row.http_attempts - 1);
    else stats.retriesUnobserved += 1;
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

const BASE_COLUMNS =
  "occurred_at,provider,model,status,attempt,input_tokens,output_tokens,cost_reported_usd,cost_estimated_usd,error_kind";

/** Lee eventos del intervalo [start, end) en páginas; consulta ligera indexada. */
export async function fetchAiUsageRows(start: Date, end: Date, maxRows = 50_000): Promise<AiUsageRow[]> {
  const db = getSupabaseClient();
  const pageSize = 1000;
  const rows: AiUsageRow[] = [];
  let columns = legacySchema ? BASE_COLUMNS : `${BASE_COLUMNS},${OPTIONAL_COLUMNS.join(",")}`;
  for (let from = 0; from < maxRows; from += pageSize) {
    let { data, error } = await db
      .from(TABLE)
      .select(columns)
      .gte("occurred_at", start.toISOString())
      .lt("occurred_at", end.toISOString())
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error && columns !== BASE_COLUMNS && isMissingOptionalColumn(error)) {
      columns = BASE_COLUMNS;
      ({ data, error } = await db
        .from(TABLE)
        .select(columns)
        .gte("occurred_at", start.toISOString())
        .lt("occurred_at", end.toISOString())
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1));
    }
    if (error) throw new Error(`ai_usage_events: ${error.message}`);
    rows.push(...((data ?? []) as unknown as AiUsageRow[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

/** true si la tabla responde a una lectura mínima (prueba de instrumentación). */
export async function probeAiUsageTable(): Promise<boolean> {
  try {
    const { error } = await getSupabaseClient().from(TABLE).select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}
