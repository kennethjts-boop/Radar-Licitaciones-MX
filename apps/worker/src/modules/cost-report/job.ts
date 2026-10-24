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
import { aggregateAiUsage, fetchAiUsageRows } from "./ai-usage";
import { compareMetrics, computeTotals } from "./analysis";
import { formatCostReport } from "./format";
import { mexicoClock, mexicoDateOf, mexicoDayBounds, previousDates, reportDateFor, shiftDate } from "./period";
import { collectOpenAi } from "./providers/openai";
import {
  buildOpenRouterLine,
  fetchOpenRouterUsage,
  openRouterDayDelta,
  SNAPSHOT_MAX_DELAY_MIN,
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
import type { AiStats, AnomalyThresholds, DayCostMetrics } from "./types";

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

// ─── Corte de medianoche (OpenRouter) ────────────────────────────────────────

export async function captureMidnightSnapshots(
  now: Date = new Date(),
  store: StateStore = supabaseStateStore(),
): Promise<void> {
  const apiKey = providerEnv().OPENROUTER_API_KEY?.trim();
  if (!apiKey) return;
  const clock = mexicoClock(now);
  if (clock.hour !== 0 || clock.minute > SNAPSHOT_MAX_DELAY_MIN) return;

  const key = snapshotKey("openrouter", mexicoDateOf(now));
  try {
    if (await store.read(key)) return;
    const usageUsd = await fetchOpenRouterUsage(apiKey, fetch, HTTP_TIMEOUT_MS);
    const snapshot: OpenRouterSnapshot = {
      usageUsd,
      capturedAt: now.toISOString(),
      delayMinutes: clock.minute,
    };
    await store.insertIfAbsent(key, snapshot);
    log.info({ key, delayMinutes: clock.minute }, "Corte de medianoche OpenRouter guardado");
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

export async function collectDayMetrics(
  date: string,
  store: StateStore,
  fetchImpl: typeof fetch = fetch,
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

  let ai: AiStats | null = null;
  try {
    ai = aggregateAiUsage(await fetchAiUsageRows(bounds.startUtc, bounds.endUtc));
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "Sin acceso a ai_usage_events");
  }

  let delta: ReturnType<typeof openRouterDayDelta> | null = null;
  try {
    const snaps = await store.readMany<OpenRouterSnapshot>([
      snapshotKey("openrouter", date),
      snapshotKey("openrouter", shiftDate(date, 1)),
    ]);
    delta = openRouterDayDelta(
      snaps.get(snapshotKey("openrouter", date)) ?? null,
      snaps.get(snapshotKey("openrouter", shiftDate(date, 1))) ?? null,
    );
  } catch (err) {
    delta = { usd: null, problem: "no se pudieron leer los cortes" };
  }

  const [openai, railway] = await Promise.all([
    collectOpenAi(ctx, sumEstimated(ai, "openai")),
    collectRailway(ctx),
  ]);
  const providers = [
    openai,
    buildOpenRouterLine(ctx, delta, sumEstimated(ai, "openrouter")),
    railway,
    supabaseLine(),
  ];
  return {
    date,
    periodStartUtc: bounds.startUtc.toISOString(),
    periodEndUtc: bounds.endUtc.toISOString(),
    providers,
    ai,
    totals: computeTotals(providers),
  };
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
}

export async function runDailyCostReport(deps: RunDeps = {}): Promise<string> {
  const config = getConfig();
  if (!config.COST_REPORT_ENABLED) return "disabled";
  const now = deps.now ?? new Date();
  if (mexicoClock(now).hour < config.COST_REPORT_HOUR) return "too_early";

  const store = deps.store ?? supabaseStateStore();
  const date = reportDateFor(now);
  const key = reportKey(date);

  // Pre-chequeo barato: evita recolectar si ya se resolvió el día.
  const existing = await store.read<ReportState>(key);
  if (existing && existing.status !== "failed") return `skip:${existing.status}`;

  const claim = await claimReport(store, date, instanceId, config.COST_REPORT_MAX_ATTEMPTS, now);
  if (!claim.claimed) {
    log.info({ date, reason: claim.reason }, "Reporte de gastos omitido");
    return `skip:${claim.reason}`;
  }

  const base: ReportState = {
    status: "claimed",
    attempts: claim.attempt,
    claimedBy: instanceId,
    claimedAt: now.toISOString(),
  };
  let metrics: DayCostMetrics | null = null;
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

    const text = formatCostReport(metrics, comparisons, {
      generatedAt: now,
      thresholds,
      lateNote: notes.join(" · ") || undefined,
    });

    const chatId = await (deps.resolveChat ?? resolvePrivateChat)();
    if (!chatId) throw new Error("no_private_chat: ningún chat configurado es privado");

    const send = deps.send ?? sendTelegramMessageSingleAttempt;
    let messageId: number;
    try {
      ({ messageId } = await send(text, chatId));
    } catch (err) {
      const details = describeTelegramSendError(err);
      const definitelyNotSent =
        details.kind === "api" || (details.kind === "network" && PRE_CONNECT_CODES.has(details.code ?? ""));
      await store.write(key, {
        ...base,
        status: definitelyNotSent ? "failed" : "uncertain",
        error: `telegram_${details.kind}${details.code ? `:${details.code}` : ""}`,
        metrics,
      });
      log.error({ date, kind: details.kind, attempt: claim.attempt }, "Reporte de gastos no entregado");
      return definitelyNotSent ? "failed" : "uncertain";
    }

    await store.write(key, { ...base, status: "sent", sentAt: new Date().toISOString(), messageId, error: null, metrics });
    log.info({ date, messageId, attempt: claim.attempt }, "Reporte de gastos enviado");
    return "sent";
  } catch (err) {
    // Antes de llamar a Telegram: seguro reintentar en la siguiente hora.
    const reason = err instanceof Error ? err.message.slice(0, 160) : "error";
    await store
      .write(key, { ...base, status: "failed", error: reason, metrics })
      .catch((e) => log.error({ err: e }, "No se pudo persistir fallo del reporte de gastos"));
    log.error({ date, reason }, "Reporte de gastos falló antes del envío");
    return "failed";
  }
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

  cron.schedule("*/5 0 * * *", safeSnapshot, { timezone: "America/Mexico_City" });
  cron.schedule(`0 ${hour}-23 * * *`, safeRun, { timezone: "America/Mexico_City" });
  // Catch-up tras reinicio: corte (si estamos en la ventana) y reporte pendiente.
  setTimeout(() => {
    void safeSnapshot();
    void safeRun();
  }, 30_000).unref();

  log.info({ cron: `0 ${hour}-23 * * *`, snapshotCron: "*/5 0 * * *" }, "Reporte de gastos programado");
}
