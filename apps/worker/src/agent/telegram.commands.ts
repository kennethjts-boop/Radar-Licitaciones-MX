/**
 * TELEGRAM COMMANDS — Bot listener y handlers.
 * Esta versión elimina todas las referencias obsoletas para desbloquear CI.
 *
 * /prueba        → Estado real del sistema
 * /buscar        → Búsqueda en expedientes
 * /debug_resumen → Telemetría detallada Fase 2A
 * /noticias_comerciales → Señales y noticias comerciales
 */
import TelegramBot from "node-telegram-bot-api";
import { getConfig } from "../config/env";
import { createModuleLogger } from "../core/logger";
import { healthTracker } from "../core/healthcheck";
import { formatDuration, formatMexicoDate, nowISO } from "../core/time";
import { withTimeout } from "../core/errors";
import { formatCurrency } from "../core/text";
import { getState, STATE_KEYS } from "../core/system-state";
import { getActiveRadars } from "../radars/index";
import { getLastCollectRun } from "../storage/collect-run.repo";
import { getLastSentAlert } from "../storage/match-alert.repo";
import type { DbCollectRun } from "../types/database";

const log = createModuleLogger("commands");
const MANUAL_SCAN_TIMEOUT_MS = 30 * 60 * 1000;

let _bot: TelegramBot | null = null;
let manualScanInFlight: Promise<void> | null = null;

export async function initCommandBot(): Promise<TelegramBot> {
  if (_bot) return _bot;

  const config = getConfig();

  // Crear instancia sin polling primero para poder llamar deleteWebhook
  _bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: false });

  // Eliminar webhook si existía — evita 409 Conflict en getUpdates
  try {
    await _bot.deleteWebHook();
    log.info("Webhook eliminado (si existía)");
  } catch (err) {
    log.warn({ err }, "No se pudo eliminar webhook — continuando");
  }

  // Registrar handlers de error antes de iniciar polling
  _bot.on("polling_error", (err: Error) => {
    log.error({ code: (err as NodeJS.ErrnoException).code, msg: err.message }, "❌ Telegram polling_error");
  });
  _bot.on("error", (err: Error) => {
    log.error({ msg: err.message }, "❌ Telegram bot error");
  });

  // Iniciar polling
  _bot.startPolling({ restart: true });
  log.info("telegram_polling_started");

  registerCommands(_bot, config.TELEGRAM_CHAT_ID);

  log.info("✅ Bot de comandos Telegram iniciado con polling");
  log.info("telegram_bot_initialized");
  return _bot;
}

export function getCommandBot(): TelegramBot | null {
  return _bot;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusIcon(status: "ok" | "degraded" | "down" | "unknown"): string {
  if (status === "ok") return "✅";
  if (status === "degraded") return "⚠️";
  if (status === "down") return "❌";
  return "⬛";
}

function serviceLabel(status: "ok" | "degraded" | "down" | "unknown"): string {
  if (status === "ok") return "OK";
  if (status === "degraded") return "DEGRADADO";
  if (status === "down") return "CAÍDO";
  return "DESCONOCIDO";
}

function nextRunEstimate(intervalMinutes: number): string {
  const now = new Date();
  const minutesPast = now.getMinutes() % intervalMinutes;
  const minutesUntilNext = intervalMinutes - minutesPast;
  const next = new Date(now.getTime() + minutesUntilNext * 60 * 1000);
  next.setSeconds(0, 0);
  return formatMexicoDate(next.toISOString(), "HH:mm");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatBool(value: unknown): string {
  return value === true ? "true" : "false";
}

function numberField(state: Record<string, unknown> | null | undefined, key: string): number {
  const value = state?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function externalNoLeadCause(external: Record<string, unknown> | null | undefined): string {
  if (!external) return "sin ciclo registrado";
  const raw = numberField(external, "rawResultsReceived");
  const detected = numberField(external, "detected");
  const discardedScore = numberField(external, "discardedByScore");
  const discardedEvidence =
    numberField(external, "discardedByEvidence") +
    numberField(external, "discardedByMissingEvidence");
  const discardedKeyword = numberField(external, "discardedByKeyword");
  const discardedScope = numberField(external, "discardedByScope");

  if (detected > 0) return `${detected} detectados; revisar score/guardado`;
  if (raw === 0) return `${numberField(external, "sourcesReviewed")} fuentes, 0 resultados crudos`;
  if (discardedScore + discardedEvidence > 0) {
    return `${raw} resultados crudos, ${discardedScore + discardedEvidence} descartados por score/evidencia`;
  }
  if (discardedKeyword + discardedScope > 0) {
    return `${raw} resultados crudos, ${discardedKeyword + discardedScope} descartados por keyword/alcance`;
  }
  return `${raw} resultados crudos, sin candidatos suficientes`;
}

function formatTopDiscarded(external: Record<string, unknown> | null | undefined): string[] {
  const rawItems = external?.topDiscardedCandidates;
  if (!Array.isArray(rawItems) || rawItems.length === 0) return ["  Top descartados: <b>ninguno</b>"];

  return [
    "  Top descartados:",
    ...rawItems.slice(0, 5).map((item) => {
      const candidate = item as Record<string, unknown>;
      const title = String(candidate.title ?? "sin título").slice(0, 80);
      const source = String(candidate.sourceName ?? "fuente").slice(0, 40);
      const score = candidate.estimatedScore ?? "N/D";
      const reasons = Array.isArray(candidate.reasons)
        ? candidate.reasons.join(", ")
        : "N/D";
      const publicUrl = candidate.publicUrl || candidate.sourceUrl
        ? ` | ${String(candidate.publicUrl ?? candidate.sourceUrl).slice(0, 90)}`
        : "";
      return `  - <b>${escapeHtml(title)}</b> | ${escapeHtml(source)} | score ${escapeHtml(score)} | ${escapeHtml(reasons)}${escapeHtml(publicUrl)}`;
    }),
  ];
}

function formatCommercialMap(value: unknown): string {
  if (!value || typeof value !== "object") return "ninguno";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, count]) => typeof count === "number" && count > 0)
    .slice(0, 5);
  return entries.length > 0
    ? entries.map(([key, count]) => `${key}: ${count}`).join(" | ")
    : "ninguno";
}

function formatCommercialCandidates(
  commercial: Record<string, unknown> | null | undefined,
  key: "topMatchedCandidates" | "topDiscardedCandidates",
): string[] {
  const items = commercial?.[key];
  if (!Array.isArray(items) || items.length === 0) {
    return [`  ${key === "topMatchedCandidates" ? "Top comerciales" : "Top descartados comerciales"}: <b>ninguno</b>`];
  }
  return [
    `  ${key === "topMatchedCandidates" ? "Top comerciales" : "Top descartados comerciales"}:`,
    ...items.slice(0, 5).map((item) => {
      const candidate = item as Record<string, unknown>;
      return `  - <b>${escapeHtml(String(candidate.title ?? "sin título").slice(0, 80))}</b> | ${escapeHtml(candidate.profile ?? "perfil")} | score ${escapeHtml(candidate.score ?? "N/D")} | ${escapeHtml(candidate.reason ?? "match")}`;
    }),
  ];
}

function pickFirst(state: Record<string, unknown> | null | undefined, keys: string[]): unknown {
  if (!state) return null;
  for (const key of keys) {
    const value = state[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function formatTelemetryDate(value: unknown): string {
  return formatMexicoDate(value as Date | string | number | null | undefined);
}

function hasUsableDate(value: unknown): boolean {
  return formatTelemetryDate(value) !== "No disponible";
}

function collectRunToState(row: DbCollectRun): Record<string, unknown> {
  const metadata = (row.metadata_json ?? {}) as Record<string, unknown>;
  return {
    collectorKey: row.collector_key,
    mode: metadata.mode ?? row.collector_key,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    errorMessage: row.error_message,
    itemsSeen: row.items_seen,
    itemsCreated: row.items_created,
    itemsUpdated: row.items_updated,
    totalMatches: metadata.totalMatches ?? 0,
    pages_scanned: metadata.pagesScanned ?? 0,
  };
}

function getLastRunTimestamp(
  lastRunState: Record<string, unknown> | null,
  lastCycleAt: string | null,
): unknown {
  return pickFirst(lastRunState, ["finishedAt", "finished_at", "lastCycleAt", "startedAt", "started_at"])
    ?? lastCycleAt;
}

async function resolveLastRunState(
  lastRunState: Record<string, unknown> | null,
  lastCycleAt: string | null,
): Promise<Record<string, unknown> | null> {
  if (hasUsableDate(getLastRunTimestamp(lastRunState, lastCycleAt))) {
    return lastRunState;
  }

  try {
    const row = await getLastCollectRun("comprasmx");
    return row ? collectRunToState(row) : lastRunState;
  } catch (err) {
    log.warn({ err }, "No se pudo leer último collect_run; usando system_state");
    return lastRunState;
  }
}

function buildLastErrorLine(
  lastRunState: Record<string, unknown> | null,
  dailySummaryState: Record<string, unknown> | null,
  external: Record<string, unknown> | null | undefined,
): string {
  const runError = pickFirst(lastRunState, ["errorMessage", "error_message"]);
  if (runError) return String(runError).slice(0, 140);

  if (dailySummaryState?.status === "error") {
    return `daily_summary: ${String(dailySummaryState.failureReason ?? "error no especificado").slice(0, 120)}`;
  }

  if (external?.status === "error" && Array.isArray(external.errors) && external.errors.length > 0) {
    return `external_osint: ${String(external.errors[0]).slice(0, 120)}`;
  }

  return "Sin errores registrados";
}

// ─── Registro de comandos ─────────────────────────────────────────────────────

function registerCommands(bot: TelegramBot, chatId: string): void {
  // ── /prueba | /estado ────────────────────────────────────────────────────
  bot.onText(/\/(prueba|estado)/, async (msg) => {
    const chatIdPartial = String(msg.chat.id).slice(-4);
    log.info({ command: msg.text, chatIdPartial, from: msg.from?.username }, "command_received");

    if (String(msg.chat.id) !== chatId) {
      log.warn({ expected: chatId, actual: msg.chat.id }, "Ignorando comando de chat no autorizado");
      return;
    }

    try {
      const config = getConfig();
      const status = healthTracker.getStatus();
      const radars = getActiveRadars();

      const rawLastRunState = await getState<Record<string, unknown>>(STATE_KEYS.LAST_COLLECT_RUN);
      const lastRunState = await resolveLastRunState(rawLastRunState, status.lastCycleAt);
      const externalState = await getState<Record<string, unknown>>(STATE_KEYS.LAST_EXTERNAL_LEADS_RUN);
      const bootState = await getState<Record<string, unknown>>(STATE_KEYS.WORKER_BOOT_TIME);
      const schedulerState = await getState<Record<string, unknown>>(STATE_KEYS.SCHEDULER_STATUS);
      const healthcheckState = await getState<Record<string, unknown>>(STATE_KEYS.LAST_HEALTHCHECK_AT);
      const dailySummaryState = await getState<Record<string, unknown>>(STATE_KEYS.LAST_DAILY_SUMMARY);
      const lastAlert = await getLastSentAlert().catch((err) => {
        log.warn({ err }, "No se pudo leer última alerta enviada");
        return null;
      });

      const dbIcon = statusIcon(status.services.database);
      const tgIcon = statusIcon(status.services.telegram);
      const workerIcon = statusIcon(status.overall);

      const nextRun = nextRunEstimate(config.COLLECT_INTERVAL_MINUTES);
      const bootTime = bootState?.bootedAt ? formatMexicoDate(String(bootState.bootedAt)) : "N/D";
      const lastRunDisplay = formatTelemetryDate(getLastRunTimestamp(lastRunState, status.lastCycleAt));
      const lastHeartbeatDisplay = formatTelemetryDate(healthcheckState?.checkedAt);
      const lastAlertDisplay = lastAlert?.sent_at
        ? formatTelemetryDate(lastAlert.sent_at)
        : "No disponible";

      const stalledLine = status.stalled
        ? [`⚠️ <b>SIN CICLOS: +${Math.floor((status.stalledForMs ?? 0) / 60_000)} min — revisar scheduler</b>`]
        : [];
      const lastCycleErrorLine = status.lastCycleStatus === "error"
        ? ["⚠️ <b>Último ciclo terminó con error — revisar /debug_resumen</b>"]
        : [];
      const degradationLine = status.degradationReasons.length > 0
        ? [`⚠️ Causa: <code>${escapeHtml(status.degradationReasons.join("; ")).slice(0, 220)}</code>`]
        : [];

      const external =
        status.externalLeads.status !== "none" ? status.externalLeads : externalState;
      const lastErrorLine = buildLastErrorLine(lastRunState, dailySummaryState, external as Record<string, unknown> | null);
      const externalRecord = external as Record<string, unknown> | null;
      const dailySummaryDisplay = dailySummaryState
        ? `${dailySummaryState.status ?? "N/D"} | Esperado: ${formatTelemetryDate(dailySummaryState.expectedAt)} | Real: ${formatTelemetryDate(dailySummaryState.finishedAt ?? dailySummaryState.actualAt ?? dailySummaryState.startedAt)}`
        : "Sin registro";
      const commercialState = lastRunState?.commercialMatching as Record<string, unknown> | undefined;
      const externalSummary = config.ENABLE_EXTERNAL_LEADS_OSINT
        ? `vivo, ${numberField(externalRecord, "detected") > 0 ? "con leads" : `sin leads: ${externalNoLeadCause(externalRecord)}`}`
        : "inactivo";

      const lines = [
        `🔍 <b>ESTADO — Radar Licitaciones MX</b>`,
        "",
        `🖥 Worker: <b>${workerIcon} ${serviceLabel(status.overall)}</b>`,
        `${dbIcon} DB: <b>${serviceLabel(status.services.database)}</b> (${status.dbConnected ? "Conectada" : "Desconectada"})`,
        `🧱 Schema: <b>${status.dbSchemaValid ? "Válido" : "Inválido"}</b>`,
        `${tgIcon} Telegram: <b>${serviceLabel(status.services.telegram)}</b>`,
        ...degradationLine,
        ...stalledLine,
        ...lastCycleErrorLine,
        "",
        `⏰ Última: <b>${lastRunDisplay}</b>`,
        `📨 Última alerta: <b>${lastAlertDisplay}</b>`,
        `💓 Heartbeat: <b>${lastHeartbeatDisplay}</b>`,
        `❌ Último error: <code>${escapeHtml(lastErrorLine)}</code>`,
        `🔜 Próxima: ~<b>${nextRun} MX</b>`,
        `📡 Scheduler: <b>${status.schedulerStatus === "active" || schedulerState?.status === "active" ? "✅ Activo" : "⏳ Iniciando"}</b>`,
        `🧾 Resumen 7am: <b>${escapeHtml(dailySummaryDisplay)}</b>`,
        `🛰 Radares: <b>${radars.length} activos</b>`,
        `💼 Motor comercial: <b>${config.COMMERCIAL_MATCHING_ENABLED ? "activo" : "inactivo"}</b> | Candidatos: <b>${numberField(commercialState, "commercialCandidates")}</b> | Matches perfiles: <b>${numberField(commercialState, "matchedProfiles")}</b>`,
        `🧭 External OSINT: <b>${escapeHtml(externalSummary)}</b> | Dry run: <b>${formatBool(config.EXTERNAL_LEADS_DRY_RUN)}</b> | Discovery: <b>${formatBool(config.EXTERNAL_LEADS_DISCOVERY_MODE)}</b>`,
        external
          ? `   Último: <b>${external.status ?? "N/D"}</b> | Fuentes: <b>${numberField(externalRecord, "sourcesReviewed")}</b> | Raw: <b>${numberField(externalRecord, "rawResultsReceived")}</b> | Detectados: <b>${numberField(externalRecord, "detected")}</b> | Guardados: <b>${numberField(externalRecord, "saved")}</b> | Alertas: <b>${numberField(externalRecord, "alerted")}</b> | Errores: <b>${Array.isArray(externalRecord?.errors) ? externalRecord.errors.length : 0}</b>`
          : `   Último: <b>N/D</b>`,
        "",
        `⏱ Uptime: <b>${formatDuration(status.uptimeMs)}</b>`,
        `🌍 Env: <b>${config.NODE_ENV}</b> | <b>${config.RAILWAY_ENVIRONMENT ?? "local"}</b>`,
      ];

      await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "HTML" });
    } catch (err) {
      log.error({ err }, "❌ Error en /prueba");
      await bot.sendMessage(chatId, "❌ Error ejecutando /prueba — revisar logs").catch(() => {});
    }
  });

  // ── /buscar ──────────────────────────────────────────────────────────────
  bot.onText(/\/buscar (.+)/, async (msg, match) => {
    const chatIdPartial = String(msg.chat.id).slice(-4);
    log.info({ command: "/buscar", chatIdPartial, from: msg.from?.username }, "command_received");
    if (String(msg.chat.id) !== chatId) return;
    const query = match?.[1]?.trim();
    if (!query) return;

    try {
      const { getSupabaseClient } = await import("../storage/client");
      const db = getSupabaseClient();
      const { data: results, error } = await db
        .from("procurements")
        .select("title,dependency_name,expediente_id,status,source_url,publication_date")
        .or(
          `title.ilike.%${query}%,` +
          `dependency_name.ilike.%${query}%,` +
          `canonical_text.ilike.%${query}%,` +
          `expediente_id.ilike.%${query}%`
        )
        .order("publication_date", { ascending: false })
        .limit(5);

      if (error) throw error;

      if (!results || results.length === 0) {
        await bot.sendMessage(chatId, `🔍 Sin resultados para: <b>${query}</b>`, { parse_mode: "HTML" });
        return;
      }

      const lines = [`🔍 <b>Resultados para "${query}" (${results.length})</b>\n`];
      for (const r of results) {
        const nombre = (r.title ?? "Sin título").slice(0, 80);
        const dep = r.dependency_name ?? "N/D";
        const estatus = r.status ?? "desconocido";
        const exp = r.expediente_id ?? "N/D";
        lines.push(`📋 <b>${nombre}</b>`);
        lines.push(`   🏛 ${dep}`);
        lines.push(`   Exp: <code>${exp}</code> | Estado: ${estatus}`);
        if (r.source_url) lines.push(`   <a href="${r.source_url}">Ver expediente</a>`);
        lines.push("");
      }

      await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "HTML", disable_web_page_preview: true });
    } catch (err) {
      log.error({ err }, "❌ Error en /buscar");
      await bot.sendMessage(chatId, "❌ Error ejecutando búsqueda").catch(() => {});
    }
  });

  // ── /monto ────────────────────────────────────────────────────────────────
  bot.onText(/\/monto (.+)/, async (msg, match) => {
    const chatIdPartial = String(msg.chat.id).slice(-4);
    log.info({ command: "/monto", chatIdPartial, from: msg.from?.username }, "command_received");
    if (String(msg.chat.id) !== chatId) return;
    const query = match?.[1]?.trim();
    if (!query) return;
    log.info({ from: msg.from?.username, query }, "📥 /monto");

    try {
      const { getSupabaseClient } = await import("../storage/client");
      const db = getSupabaseClient();
      const { data: result, error } = await db
        .from("procurements")
        .select("amount,currency,licitation_number,dependency_name,state,municipality,opening_date,source_url")
        .or(
          `external_id.ilike.%${query}%,` +
          `licitation_number.ilike.%${query}%,` +
          `procedure_number.ilike.%${query}%`
        )
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!result) {
        await bot.sendMessage(chatId, `❌ No encontré esa licitación: <b>${query}</b>`, { parse_mode: "HTML" });
        return;
      }

      if (result.amount === null || result.amount === undefined) {
        await bot.sendMessage(
          chatId,
          `⚠️ Monto no disponible para este expediente.\n📋 <b>${result.licitation_number ?? query}</b>`,
          { parse_mode: "HTML" },
        );
        return;
      }

      const lines = [
        `💰 <b>Monto:</b> ${formatCurrency(result.amount as number, result.currency as "MXN" | "USD" | null)}`,
        `📋 <b>${result.licitation_number ?? "N/D"}</b>`,
        `🏛 ${result.dependency_name ?? "N/D"}`,
        result.state
          ? `📍 ${result.municipality ? `${result.municipality as string}, ` : ""}${result.state as string}`
          : "",
        result.opening_date
          ? `📅 <b>Apertura:</b> ${formatMexicoDate(result.opening_date as string, "dd/MM/yyyy HH:mm")}`
          : "",
        result.source_url ? `🔗 ${result.source_url as string}` : "",
      ];

      await bot.sendMessage(chatId, lines.filter(Boolean).join("\n"), {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    } catch (err) {
      log.error({ err }, "❌ Error en /monto");
      await bot.sendMessage(chatId, "❌ Error buscando el expediente").catch(() => {});
    }
  });

  // ── /debug_resumen ────────────────────────────────────────────────────────
  bot.onText(/\/debug_resumen/, async (msg) => {
    const chatIdPartial = String(msg.chat.id).slice(-4);
    log.info({ command: "/debug_resumen", chatIdPartial, from: msg.from?.username }, "command_received");
    if (String(msg.chat.id) !== chatId) return;
    log.info({ from: msg.from?.username }, "📥 /debug_resumen");

    try {
      const status = healthTracker.getStatus();
      const rawLastRunState = await getState<Record<string, unknown>>(STATE_KEYS.LAST_COLLECT_RUN);
      const lastRunState = await resolveLastRunState(rawLastRunState, status.lastCycleAt);
      const externalState = await getState<Record<string, unknown>>(STATE_KEYS.LAST_EXTERNAL_LEADS_RUN);
      const config = getConfig();
      const radars = getActiveRadars();
      const external =
        status.externalLeads.status !== "none" ? status.externalLeads : externalState;
      const externalRecord = external as Record<string, unknown> | null;
      const commercialState = lastRunState?.commercialMatching as Record<string, unknown> | undefined;

      const lines = [
        `🔧 <b>TELEMETRÍA — Radar Licitaciones MX</b>`,
        "",
        `<b>Ciclo:</b> ${formatTelemetryDate(getLastRunTimestamp(lastRunState, status.lastCycleAt))}`,
        `<b>Status:</b> ${lastRunState?.status ?? "N/D"} | <b>Mode:</b> ${lastRunState?.mode ?? "N/D"}`,
        "",
        `<b>📊 Indicadores Fase 2A:</b>`,
        `  Pages: <b>${lastRunState?.pages_scanned ?? 0}</b>`,
        `  Seen: <b>${lastRunState?.total_listing_rows_seen ?? 0}</b>`,
        `  Fetched: <b>${lastRunState?.detail_fetch_executed ?? 0}</b>`,
        `  Skipped: <b>${lastRunState?.skipped_by_fingerprint ?? 0}</b>`,
        `  New: <b>${lastRunState?.total_new_detected ?? 0}</b>`,
        `  Mutated: <b>${lastRunState?.total_mutated_detected ?? 0}</b>`,
        `  Matches: <b>${lastRunState?.totalMatches ?? 0}</b>`,
        `  Alertas enviadas: <b>${lastRunState?.alertsSent ?? 0}</b>`,
        `  Streak: <b>${lastRunState?.known_streak ?? 0}</b>`,
        `  Stop: <code>${String(lastRunState?.stop_reason ?? "N/D").slice(0, 50)}</code>`,
        "",
        `<b>💼 Motor comercial:</b> ${config.COMMERCIAL_MATCHING_ENABLED ? "activo" : "inactivo"}`,
        `  Revisados: <b>${numberField(commercialState, "totalReviewed")}</b>`,
        `  Raw results: <b>${numberField(commercialState, "rawResultsReceived")}</b>`,
        `  Candidatos comerciales: <b>${numberField(commercialState, "commercialCandidates")}</b>`,
        `  Matches por perfil: <code>${escapeHtml(formatCommercialMap(commercialState?.matchesByProfile))}</code>`,
        `  Matches por territorio: <code>${escapeHtml(formatCommercialMap(commercialState?.matchesByTerritory))}</code>`,
        `  Desc. sin territorio: <b>${numberField(commercialState, "discardedByNoTerritory")}</b>`,
        `  Desc. keyword: <b>${numberField(commercialState, "discardedByKeyword")}</b>`,
        `  Desc. negative keyword: <b>${numberField(commercialState, "discardedByNegativeKeyword")}</b>`,
        `  Desc. bajo score: <b>${numberField(commercialState, "discardedByLowScore")}</b>`,
        `  Desc. evidencia: <b>${numberField(commercialState, "discardedByMissingEvidence")}</b>`,
        ...formatCommercialCandidates(commercialState, "topMatchedCandidates"),
        ...formatCommercialCandidates(commercialState, "topDiscardedCandidates"),
        "",
        `<b>🧭 External OSINT:</b> ${config.ENABLE_EXTERNAL_LEADS_OSINT ? "activo" : "inactivo"}`,
        `  Dry run: <b>${formatBool(config.EXTERNAL_LEADS_DRY_RUN)}</b>`,
        `  Discovery mode: <b>${formatBool(config.EXTERNAL_LEADS_DISCOVERY_MODE)}</b>`,
        `  Último ciclo: <b>${external?.status ?? "N/D"}</b>`,
        `  Fuentes revisadas: <b>${numberField(externalRecord, "sourcesReviewed")}</b>`,
        `  Resultados crudos: <b>${numberField(externalRecord, "rawResultsReceived")}</b>`,
        `  Normalizados: <b>${numberField(externalRecord, "normalized")}</b>`,
        `  Detectados: <b>${numberField(externalRecord, "detected")}</b>`,
        `  Guardados: <b>${numberField(externalRecord, "saved")}</b>`,
        `  Alertas: <b>${numberField(externalRecord, "alerted")}</b>`,
        `  Descartados keyword: <b>${numberField(externalRecord, "discardedByKeyword")}</b>`,
        `  Descartados evidencia: <b>${numberField(externalRecord, "discardedByEvidence") + numberField(externalRecord, "discardedByMissingEvidence")}</b>`,
        `  Descartados fecha: <b>${numberField(externalRecord, "discardedByDate")}</b>`,
        `  Descartados sanitización: <b>${numberField(externalRecord, "discardedBySanitization")}</b>`,
        `  Descartados alcance: <b>${numberField(externalRecord, "discardedByScope")}</b>`,
        `  Descartados score: <b>${numberField(externalRecord, "discardedByScore")}</b>`,
        `  Descartados dedupe: <b>${numberField(externalRecord, "discardedByDeduplication")}</b>`,
        `  Errores: <b>${Array.isArray(externalRecord?.errors) ? externalRecord.errors.length : 0}</b>`,
        ...formatTopDiscarded(externalRecord),
        "",
        lastRunState?.errorMessage ? `⚠️ <b>Error:</b> <code>${String(lastRunState.errorMessage).slice(0, 100)}</code>` : "",
        "",
        `<b>Radares:</b> ${radars.length} | <b>Uptime:</b> ${formatDuration(status.uptimeMs)}`,
      ];

      await bot.sendMessage(chatId, lines.filter(Boolean).join("\n"), { parse_mode: "HTML" });
    } catch (err) {
      log.error({ err }, "❌ Error en /debug_resumen");
      await bot.sendMessage(chatId, "❌ Error en /debug_resumen — Solo texto habilitado").catch(() => {});
    }
  });

  // ── /scan ──────────────────────────────────────────────────────────────
  bot.onText(/\/scan/, async (msg) => {
    const chatIdPartial = String(msg.chat.id).slice(-4);
    log.info({ command: "/scan", chatIdPartial, from: msg.from?.username }, "command_received");
    if (String(msg.chat.id) !== chatId) return;
    log.info({ from: msg.from?.username }, "📥 /scan");

    try {
      if (manualScanInFlight) {
        await bot.sendMessage(
          chatId,
          "⏳ Ya hay un escaneo manual en curso. Usa /debug_resumen para ver el último estado registrado.",
        ).catch(() => {});
        return;
      }

      const { runCollectJob } = await import("../jobs/collect.job");
      await bot.sendMessage(
        chatId,
        "🚀 Escaneo manual de ComprasMX iniciado. Te aviso al terminar o si se bloquea.",
      ).catch(() => {});

      manualScanInFlight = (async () => {
        try {
          const result = await withTimeout(
            runCollectJob(),
            MANUAL_SCAN_TIMEOUT_MS,
            "telegram-/scan",
          );

          if (result.status === "skipped") {
            await bot.sendMessage(
              chatId,
              `⏳ <b>Escaneo no iniciado</b>\nMotivo: <code>${escapeHtml(result.reason ?? result.stopReason ?? "ciclo activo")}</code>`,
              { parse_mode: "HTML" },
            ).catch(() => {});
            return;
          }

          const ok = result.status === "success";
          const lines = [
            `${ok ? "✅" : "⚠️"} <b>Escaneo manual ${ok ? "terminado" : "terminó con error"}</b>`,
            "",
            `⏱ Duración: <b>${formatDuration(result.durationMs)}</b>`,
            `📄 Páginas: <b>${result.pagesScanned}</b>`,
            `👀 Vistos: <b>${result.itemsSeen}</b>`,
            `🆕 Nuevos: <b>${result.itemsCreated}</b>`,
            `🔄 Actualizados: <b>${result.itemsUpdated}</b>`,
            `🎯 Matches: <b>${result.totalMatches}</b>`,
            result.stopReason ? `🛑 Stop: <code>${escapeHtml(result.stopReason).slice(0, 160)}</code>` : "",
            result.errorMessage ? `⚠️ Error: <code>${escapeHtml(result.errorMessage).slice(0, 240)}</code>` : "",
          ];

          await bot.sendMessage(chatId, lines.filter(Boolean).join("\n"), {
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }).catch(() => {});
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error({ err }, "Error en ejecución de /scan");
          await bot.sendMessage(
            chatId,
            `❌ <b>Escaneo manual bloqueado o fallido</b>\n<code>${escapeHtml(message).slice(0, 240)}</code>`,
            { parse_mode: "HTML" },
          ).catch(() => {});
        } finally {
          manualScanInFlight = null;
        }
      })();
    } catch (err) {
      log.error({ err }, "❌ Error inicializando /scan");
      manualScanInFlight = null;
      await bot.sendMessage(chatId, "❌ Error iniciando escaneo manual").catch(() => {});
    }
  });

  // ── /recuperar ──────────────────────────────────────────────────────────
  bot.onText(/\/recuperar/, async (msg) => {
    const chatIdPartial = String(msg.chat.id).slice(-4);
    log.info({ command: "/recuperar", chatIdPartial, from: msg.from?.username }, "command_received");
    if (String(msg.chat.id) !== chatId) return;
    log.info({ from: msg.from?.username }, "📥 /recuperar");

    try {
      // Importar dinámicamente para no cargar el script al inicio
      // Usaremos una función exportada para que sea más limpio
      const { runBackfill } = await import("../scripts/backfill-capufe-logic");
      runBackfill().catch((err) => {
        log.error({ err }, "Error en ejecución de /recuperar");
      });
    } catch (err) {
      log.error({ err }, "❌ Error inicializando /recuperar");
      await bot.sendMessage(chatId, "❌ Error iniciando recuperación de datos").catch(() => {});
    }
  });

  // ── /techo ────────────────────────────────────────────────────────────────
  // Módulo: financial-ceiling-radar (aislado, solo bajo demanda del usuario)
  // Para desactivar: ENABLE_FINANCIAL_CEILING_COMMAND=false
  bot.onText(/\/techo (.+)/, async (msg, match) => {
    const chatIdPartial = String(msg.chat.id).slice(-4);
    log.info({ command: "/techo", chatIdPartial, from: msg.from?.username }, "command_received");
    if (String(msg.chat.id) !== chatId) return;
    const query = match?.[1]?.trim() ?? "";
    log.info({ from: msg.from?.username, query }, "📥 /techo");

    // Importación dinámica — el módulo no se carga hasta que se pide
    try {
      const { handleTechoCommand } = await import("../modules/financial-ceiling-radar/telegram-handler");
      await handleTechoCommand(bot, chatId, query);
    } catch (err) {
      log.error({ err }, "❌ Error importando módulo /techo");
      await bot.sendMessage(chatId, "❌ Error cargando el módulo de análisis financiero").catch(() => {});
    }
  });

  // ── /radares ─────────────────────────────────────────────────────────────
  bot.onText(/\/radares/, async (msg) => {
    const chatIdPartial = String(msg.chat.id).slice(-4);
    log.info({ command: msg.text, chatIdPartial, from: msg.from?.username }, "command_received");

    if (String(msg.chat.id) !== chatId) return;

    try {
      const radars = getActiveRadars();
      const lines = [
        `📡 <b>Radares Activos (${radars.length})</b>`,
        "",
        ...radars.map(r => `• <b>${r.name}</b> [<code>${r.key}</code>] (Prio: ${r.priority})`)
      ];
      await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "HTML" });
    } catch (err) {
      log.error({ err }, "❌ Error en /radares");
    }
  });

  // ── /noticias_comerciales ──────────────────────────────────────────────────
  bot.onText(/\/noticias_comerciales(?:\s+(\d+))?/, async (msg, match) => {
    const chatIdPartial = String(msg.chat.id).slice(-4);
    log.info({ command: msg.text, chatIdPartial, from: msg.from?.username }, "command_received");

    if (String(msg.chat.id) !== chatId) return;

    let limit = 5;
    if (match?.[1]) {
      const parsed = parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(parsed, 10);
      }
    }

    try {
      const { getSupabaseClient } = await import("../storage/client");
      const { isUnwantedTitle } = await import("../modules/external-opportunity-discovery/source-adapters");
      const { redactSensitivePublicData } = await import("../modules/external-opportunity-discovery/matching");

      const db = getSupabaseClient();
      const { data: results, error } = await db
        .from("external_leads")
        .select("*")
        .order("estimated_interest_score", { ascending: false })
        .limit(50);

      if (error) throw error;

      if (!results || results.length === 0) {
        await bot.sendMessage(
          chatId,
          "No hay noticias comerciales útiles por ahora. External OSINT está activo y revisando fuentes.",
          { parse_mode: "HTML" }
        );
        return;
      }

      const validLeads = results
        .map((r) => {
          if (!r.title || isUnwantedTitle(r.title)) return null;

          const cleanTitle = redactSensitivePublicData(r.title);
          const territory = r.state || "Nacional / posible";

          const isPressRelease = r.raw_json?.sourceType === "press_release";
          const score = r.estimated_interest_score ?? 0;
          let classification = "posible oportunidad";
          if (isPressRelease) {
            classification = score <= 35 ? "noticia débil" : "señal comercial";
          } else {
            classification = score >= 75 ? "convocatoria/procedimiento" : "posible oportunidad";
          }

          const companyName = r.raw_json?.referenceCompany ?? "General";
          const profileName = r.raw_json?.commercialProfileId ?? "General";

          const reasonsList = Array.isArray(r.raw_json?.scoreReasons)
            ? r.raw_json.scoreReasons
            : (r.score_reasons ? (Array.isArray(r.score_reasons) ? r.score_reasons : [r.score_reasons]) : []);

          return {
            title: cleanTitle,
            source: r.source_name ?? "OSINT",
            profile: `${companyName} (${profileName})`,
            territory,
            score,
            reasons: reasonsList.join(", ") || "Fuerza de coincidencia básica",
            url: r.source_url,
            classification,
            isOfficial: r.is_official_source === true,
            publishedAt: r.source_published_at || r.detected_at,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      const targetTerritories = ["morelos", "jalisco", "guadalajara", "cdmx", "ciudad de mexico", "mexico", "edomex"];
      validLeads.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.isOfficial !== a.isOfficial) return (b.isOfficial ? 1 : 0) - (a.isOfficial ? 1 : 0);
        
        const aTarget = targetTerritories.some(t => a.territory.toLowerCase().includes(t));
        const bTarget = targetTerritories.some(t => b.territory.toLowerCase().includes(t));
        if (aTarget !== bTarget) return (bTarget ? 1 : 0) - (aTarget ? 1 : 0);

        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      });

      const slice = validLeads.slice(0, limit);
      if (slice.length === 0) {
        await bot.sendMessage(
          chatId,
          "No hay noticias comerciales útiles por ahora. External OSINT está activo y revisando fuentes.",
          { parse_mode: "HTML" }
        );
        return;
      }

      const lines = [`📰 <b>SEÑALES Y NOTICIAS COMERCIALES RECIENTES (${slice.length})</b>\n`];
      for (const item of slice) {
        lines.push(`📋 <b>${escapeHtml(item.title)}</b>`);
        lines.push(`   🏢 Perfil: ${escapeHtml(item.profile)}`);
        lines.push(`   📍 Territorio: ${escapeHtml(item.territory)}`);
        lines.push(`   📊 Score: <b>${item.score}</b> | Razón: <code>${escapeHtml(item.reasons)}</code>`);
        lines.push(`   🏷 Clasificación: <b>${escapeHtml(item.classification)}</b>`);
        lines.push(`   🏛 Fuente: ${escapeHtml(item.source)}`);
        if (item.url) {
          lines.push(`   🔗 <a href="${escapeHtml(item.url)}">Ver noticia pública</a>`);
        }
        lines.push("");
      }

      await bot.sendMessage(chatId, lines.join("\n"), {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    } catch (err) {
      log.error({ err }, "❌ Error en /noticias_comerciales");
      await bot.sendMessage(chatId, "❌ Error al consultar las noticias comerciales.").catch(() => {});
    }
  });

  log.info("telegram_handlers_registered");
  log.info("✅ Comandos registrados: /prueba, /estado, /radares, /buscar, /monto, /debug_resumen, /scan, /recuperar, /techo, /noticias_comerciales");
}
