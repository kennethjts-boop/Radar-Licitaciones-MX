/**
 * REPORTE DIARIO DE GASTOS — job independiente del scheduler principal.
 *
 * - 00:00–00:20 MX: corte del contador de OpenRouter (cada 5 min si falta).
 * - COST_REPORT_HOUR (08:00 MX) en adelante, cada hora: envía el reporte del
 *   día anterior si aún no se envió (catch-up tras reinicio y reintento
 *   limitado a COST_REPORT_MAX_ATTEMPTS).
 * - Nunca lanza hacia el scheduler; nunca llama a un modelo de IA.
 * - No pausa, bloquea ni rota nada: sólo informa.
 */
import cron from "node-cron";
import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import { withLock } from "../../core/lock";
import { buildPollingInstanceId } from "../bot/instance-lock";
import {
  describeTelegramSendError,
  getTelegramChatType,
  sendTelegramMessageSingleAttempt,
} from "../../alerts/telegram.alerts";
import { parseAdminUserIds } from "../control/authorization";
import { aggregateAiUsage, fetchAiUsageRows, probeAiUsageTable, type AiUsageRow } from "./ai-usage";
import { compareMetrics, computeTotals } from "./analysis";
import {
  classifyCoverage,
  COVERAGE_KEY,
  coverageNote,
  ensureCoverageMarker,
  gapKey,
  type CoverageMarker,
  type GapRecord,
} from "./coverage";
import { formatCostReport } from "./format";
import { mexicoClock, mexicoDateOf, mexicoDayBounds, previousDates, reportDateFor, shiftDate } from "./period";
import { collectOpenAi } from "./providers/openai";
import {
  buildOpenRouterLine,
  fetchOpenRouterUsage,
  openRouterDayDelta,
  openRouterKeyId,
  openRouterReconciliation,
  snapshotDatesFor,
  type OpenRouterDelta,
  type OpenRouterSnapshot,
} from "./providers/openrouter";
import { collectRailway } from "./providers/railway";
import { supabaseLine } from "./providers/supabase";
import type { ProviderContext, ProviderEnv } from "./providers/context";
import {
  claimReport,
  reportKey,
  snapshotKey,
  supabaseStateStore,
  type ReportState,
  type StateStore,
} from "./report-state";
import type { AiStats, AnomalyThresholds, DayCostMetrics, DayCoverage, ProviderLine } from "./types";

const log = createModuleLogger("cost-report");
const HTTP_TIMEOUT_MS = 10_000;
const instanceId = buildPollingInstanceId();
// Errores de red previos a la conexión: Telegram no recibió el mensaje.
const PRE_CONNECT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

function providerEnv(): ProviderEnv {
  const c = getConfig();
  return {
    OPENAI_ADMIN_KEY: c.OPENAI_ADMIN_KEY,
    OPENAI_PROJECT_ID: c.OPENAI_PROJECT_ID,
    OPENROUTER_API_KEY: c.OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY,
    OPENROUTER_KEY_DEDICATED: c.OPENROUTER_KEY_DEDICATED,
    RAILWAY_API_TOKEN: c.RAILWAY_API_TOKEN,
    RAILWAY_PROJECT_ID: c.RAILWAY_PROJECT_ID,
    RAILWAY_SERVICE_ID: c.RAILWAY_SERVICE_ID,
    SUPABASE_COMPUTE_SIZE: c.SUPABASE_COMPUTE_SIZE,
  };
}

export function thresholdsFromConfig(): AnomalyThresholds {
  const c = getConfig();
  return {
    pct: c.COST_ANOMALY_PCT,
    minUsd: c.COST_ANOMALY_MIN_USD,
    minDays: c.COST_ANOMALY_MIN_DAYS,
    minRequests: c.COST_ANOMALY_MIN_REQUESTS,
    minErrors: c.COST_ANOMALY_MIN_ERRORS,
  };
}

// ─── Corte diario del contador (OpenRouter) ─────────────────────────────────

/**
 * Primer corte del día MX en curso. El cron de las 00:00 MX produce el corte
 * alineado; si falla o el worker estaba caído, cualquier corte posterior del
 * mismo día se guarda con su hora real y el reporte lo trata como referencia.
 */
export async function captureMidnightSnapshots(
  clock: () => Date = () => new Date(),
  store: StateStore = supabaseStateStore(),
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const apiKey = providerEnv().OPENROUTER_API_KEY?.trim();
  if (!apiKey) return;
  const key = snapshotKey("openrouter", mexicoDateOf(clock()));
  try {
    if (await store.read(key)) return;
    const usageUsd = await fetchOpenRouterUsage(apiKey, fetchImpl, HTTP_TIMEOUT_MS);
    const capturedAt = clock();
    // Si la lectura terminó ya en otro día MX, no se guarda bajo la clave vieja.
    if (snapshotKey("openrouter", mexicoDateOf(capturedAt)) !== key) return;
    const snapshot: OpenRouterSnapshot = {
      usageUsd,
      capturedAt: capturedAt.toISOString(),
      keyId: openRouterKeyId(apiKey),
    };
    await store.insertIfAbsent(key, snapshot);
    log.info({ key, capturedAt: snapshot.capturedAt }, "Corte del contador OpenRouter guardado");
  } catch (err) {
    log.warn({ key, err: err instanceof Error ? err.message : String(err) }, "No se pudo tomar corte OpenRouter");
  }
}

// ─── Recolección ─────────────────────────────────────────────────────────────

function sumEstimated(ai: AiStats | null, provider: "openai" | "openrouter"): number | null {
  if (!ai) return null;
  const models = ai.byModel.filter((m) => m.provider === provider && m.estimatedUsd !== null);
  if (!models.length) return ai.byModel.some((m) => m.provider === provider) ? null : 0;
  return models.reduce((s, m) => s + (m.estimatedUsd as number), 0);
}

/** Aplica la cobertura del registro de IA a una línea que depende de él. */
function applyAiCoverage(line: ProviderLine, coverage: DayCoverage): ProviderLine {
  line.coverage = { status: coverage.status, note: coverageNote(coverage) };
  if (coverage.status === "none") {
    line.estimatedUsd = null;
    line.estimateDetail = undefined;
  }
  return line;
}

export type ReadAiRows = (start: Date, end: Date) => Promise<AiUsageRow[]>;

export async function collectDayMetrics(
  date: string,
  store: StateStore,
  fetchImpl: typeof fetch = fetch,
  readRows: ReadAiRows = fetchAiUsageRows,
): Promise<DayCostMetrics> {
  const bounds = mexicoDayBounds(date);
  const ctx: ProviderContext = {
    date,
    startUtc: bounds.startUtc,
    endUtc: bounds.endUtc,
    env: providerEnv(),
    fetch: fetchImpl,
    timeoutMs: HTTP_TIMEOUT_MS,
  };

  // Cobertura: sin marcador o gap ilegible → se asume lo más conservador.
  let marker: CoverageMarker | null = null;
  let gap: GapRecord | null = null;
  try {
    const states = await store.readMany<CoverageMarker | GapRecord>([COVERAGE_KEY, gapKey(date)]);
    marker = (states.get(COVERAGE_KEY) as CoverageMarker | undefined) ?? null;
    gap = (states.get(gapKey(date)) as GapRecord | undefined) ?? null;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "No se pudo leer la cobertura de medición");
  }
  const coverage = classifyCoverage(date, marker, gap);

  // Un día sin cobertura no se consulta: 0 filas no significa 0 gasto.
  let ai: AiStats | null = null;
  if (coverage.status !== "none") {
    try {
      ai = aggregateAiUsage(await readRows(bounds.startUtc, bounds.endUtc));
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "Sin acceso a ai_usage_events");
    }
  }

  let delta: OpenRouterDelta | null = null;
  try {
    const [startKey, endKey] = snapshotDatesFor(date).map((d) => snapshotKey("openrouter", d));
    const snaps = await store.readMany<OpenRouterSnapshot>([startKey, endKey]);
    delta = openRouterDayDelta(date, snaps.get(startKey) ?? null, snaps.get(endKey) ?? null);
  } catch {
    delta = { usd: null, aligned: false, problem: "no se pudieron leer los cortes" };
  }

  // Contraste OpenRouter: eventos del periodo REAL de los cortes.
  let periodRows: AiUsageRow[] | null = null;
  const covered = marker?.since && delta?.periodStart && new Date(marker.since) <= new Date(delta.periodStart);
  if (covered && delta?.usd !== null && delta?.periodEnd) {
    try {
      periodRows = await readRows(new Date(delta.periodStart as string), new Date(delta.periodEnd));
    } catch {
      periodRows = null;
    }
  }

  const [openai, railway] = await Promise.all([
    collectOpenAi(ctx, sumEstimated(ai, "openai"), coverage.status === "complete" ? ai?.byModel ?? null : null),
    collectRailway(ctx),
  ]);
  const openrouter = buildOpenRouterLine(ctx, delta, sumEstimated(ai, "openrouter"));
  openrouter.reconciliation = openRouterReconciliation(delta, periodRows, marker?.since ?? null);
  railway.coverage = { status: "not_applicable" };
  const providers = [
    applyAiCoverage(openai, coverage),
    applyAiCoverage(openrouter, coverage),
    railway,
    supabaseLine(ctx.env.SUPABASE_COMPUTE_SIZE),
  ];
  return {
    date,
    periodStartUtc: bounds.startUtc.toISOString(),
    periodEndUtc: bounds.endUtc.toISOString(),
    providers,
    ai,
    totals: computeTotals(providers),
    coverage,
  };
}

/** Registra el inicio de la medición confiable (una sola vez). Nunca lanza. */
export async function ensureMeasurementCoverage(store: StateStore = supabaseStateStore()): Promise<void> {
  try {
    const marker = await ensureCoverageMarker(store, probeAiUsageTable, instanceId);
    if (!marker) log.warn("ai_usage_events no responde: la medición confiable aún no inicia");
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "No se pudo registrar la cobertura de medición");
  }
}

// ─── Destino ─────────────────────────────────────────────────────────────────

/** Chat privado ya autorizado: COST_REPORT_CHAT_ID o TELEGRAM_CHAT_ID, luego admins. */
export async function resolvePrivateChat(
  chatType: (id: string) => Promise<string | null> = getTelegramChatType,
): Promise<string | null> {
  const c = getConfig();
  const candidates = [
    c.COST_REPORT_CHAT_ID?.trim(),
    c.TELEGRAM_CHAT_ID,
    ...parseAdminUserIds(c.TELEGRAM_ADMIN_CHAT_IDS),
  ].filter((v): v is string => Boolean(v));
  for (const id of [...new Set(candidates)]) {
    if ((await chatType(id)) === "private") return id;
  }
  return null;
}

// ─── Envío ───────────────────────────────────────────────────────────────────

export interface RunDeps {
  store?: StateStore;
  now?: Date;
  fetchImpl?: typeof fetch;
  send?: (text: string, chatId: string) => Promise<{ messageId: number }>;
  resolveChat?: () => Promise<string | null>;
  persistRetryDelayMs?: number;
}

/**
 * Días cuya entrega este proceso confirmó o dejó incierta. Segunda barrera
 * contra reenvíos si system_state no pudo registrar el resultado.
 */
const deliveryGuard = new Set<string>();

export function resetDeliveryGuardForTests(): void {
  deliveryGuard.clear();
}

const PERSIST_ATTEMPTS = 3;

async function persistOutcome(store: StateStore, key: string, value: ReportState, delayMs: number): Promise<boolean> {
  for (let i = 1; i <= PERSIST_ATTEMPTS; i++) {
    try {
      await store.write(key, value);
      return true;
    } catch (err) {
      log.warn({ key, status: value.status, intento: i, err: err instanceof Error ? err.message : String(err) },
        "No se pudo persistir resultado del reporte de gastos");
      if (i < PERSIST_ATTEMPTS) await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
  return false;
}

export async function runDailyCostReport(deps: RunDeps = {}): Promise<string> {
  const config = getConfig();
  if (!config.COST_REPORT_ENABLED) return "disabled";
  const now = deps.now ?? new Date();
  if (mexicoClock(now).hour < config.COST_REPORT_HOUR) return "too_early";

  const store = deps.store ?? supabaseStateStore();
  const date = reportDateFor(now);
  const key = reportKey(date);
  const persistDelay = deps.persistRetryDelayMs ?? 500;
  if (deliveryGuard.has(date)) return "skip:delivered_in_process";

  // Pre-chequeo barato: evita recolectar si ya se resolvió el día.
  const existing = await store.read<ReportState>(key);
  if (existing && existing.status !== "failed") return `skip:${existing.status}`;

  const claim = await claimReport(store, date, instanceId, config.COST_REPORT_MAX_ATTEMPTS, now);
  if (!claim.claimed) {
    log.info({ date, reason: claim.reason }, "Reporte de gastos omitido");
    return `skip:${claim.reason}`;
  }
  // Desde aquí la fila queda en status=claimed, que nunca se reenvía: si una
  // escritura posterior falla, ese estado sigue bloqueando reenvíos.
  const base: ReportState = {
    status: "claimed",
    attempts: claim.attempt,
    claimedBy: instanceId,
    claimedAt: now.toISOString(),
  };

  // Fase 1 — preparar, sin efectos externos. Un fallo aquí es reintentable.
  let metrics: DayCostMetrics | null = null;
  let text: string;
  let chatId: string;
  try {
    metrics = await collectDayMetrics(date, store, deps.fetchImpl ?? fetch);
    const historyKeys = previousDates(date, 7).map(reportKey);
    const historyMap = await store.readMany<ReportState>(historyKeys);
    const history = historyKeys
      .map((k) => historyMap.get(k)?.metrics)
      .filter((m): m is DayCostMetrics => Boolean(m));
    const thresholds = thresholdsFromConfig();
    const comparisons = compareMetrics(metrics, history, thresholds);

    const notes: string[] = [];
    if (mexicoClock(now).hour > config.COST_REPORT_HOUR || claim.attempt > 1) {
      notes.push(`Enviado con retraso (intento ${claim.attempt})`);
    }
    const prev = historyMap.get(reportKey(shiftDate(date, -1)));
    if (prev && prev.status !== "sent") notes.push(`El reporte del ${shiftDate(date, -1)} quedó en estado ${prev.status}`);

    text = formatCostReport(metrics, comparisons, {
      generatedAt: now,
      thresholds,
      lateNote: notes.join(" · ") || undefined,
    });
    const resolved = await (deps.resolveChat ?? resolvePrivateChat)();
    if (!resolved) throw new Error("no_private_chat: ningún chat configurado es privado");
    chatId = resolved;
  } catch (err) {
    const reason = err instanceof Error ? err.message.slice(0, 160) : "error";
    await persistOutcome(store, key, { ...base, status: "failed", error: reason, metrics }, persistDelay);
    log.error({ date, reason }, "Reporte de gastos falló antes del envío");
    return "failed";
  }

  // Fase 2 — un solo intento de envío.
  let messageId: number | null = null;
  let sendError: unknown = null;
  try {
    ({ messageId } = await (deps.send ?? sendTelegramMessageSingleAttempt)(text, chatId));
  } catch (err) {
    sendError = err;
  }

  // Fase 3 — registrar. Una entrega confirmada o incierta nunca pasa a failed.
  if (sendError === null) {
    deliveryGuard.add(date);
    const ok = await persistOutcome(
      store,
      key,
      { ...base, status: "sent", sentAt: new Date().toISOString(), messageId, error: null, metrics },
      persistDelay,
    );
    if (!ok) {
      log.error({ date, messageId }, "Reporte entregado pero sin registrar 'sent'; status=claimed bloquea reenvíos");
      return "sent_unpersisted";
    }
    log.info({ date, messageId, attempt: claim.attempt }, "Reporte de gastos enviado");
    return "sent";
  }

  const details = describeTelegramSendError(sendError);
  const definitelyNotSent =
    details.kind === "api" || (details.kind === "network" && PRE_CONNECT_CODES.has(details.code ?? ""));
  if (!definitelyNotSent) deliveryGuard.add(date);
  await persistOutcome(
    store,
    key,
    {
      ...base,
      status: definitelyNotSent ? "failed" : "uncertain",
      error: `telegram_${details.kind}${details.code ? `:${details.code}` : ""}`,
      metrics,
    },
    persistDelay,
  );
  log.error({ date, kind: details.kind, attempt: claim.attempt }, "Reporte de gastos no entregado");
  return definitelyNotSent ? "failed" : "uncertain";
}

// ─── Programación ────────────────────────────────────────────────────────────

export function startCostReportScheduler(): void {
  const config = getConfig();
  if (!config.COST_REPORT_ENABLED) {
    log.info("COST_REPORT_ENABLED=false — reporte de gastos desactivado");
    return;
  }
  const hour = config.COST_REPORT_HOUR;
  const safeRun = () =>
    withLock("cost-report", "cost-report", () => runDailyCostReport()).catch((err) =>
      log.error({ err }, "Error no manejado en reporte de gastos"),
    );
  const safeSnapshot = () =>
    captureMidnightSnapshots().catch((err) => log.warn({ err }, "Error en corte de medianoche"));
  const safeCoverage = () => ensureMeasurementCoverage();

  cron.schedule("*/5 0 * * *", safeSnapshot, { timezone: "America/Mexico_City" });
  cron.schedule(
    `0 ${hour}-23 * * *`,
    async () => {
      await safeCoverage();
      await safeSnapshot();
      await safeRun();
    },
    { timezone: "America/Mexico_City" },
  );
  // Catch-up tras reinicio: corte del día si falta y reporte pendiente.
  setTimeout(() => {
    void (async () => {
      await safeCoverage();
      await safeSnapshot();
      await safeRun();
    })();
  }, 30_000).unref();

  log.info({ cron: `0 ${hour}-23 * * *`, snapshotCron: "*/5 0 * * *" }, "Reporte de gastos programado");
}
