/**
 * TELEGRAM COMMANDS — Bot listener y handlers.
 * Arranca polling solo cuando se inicializa.
 *
 * /prueba  → Estado real del sistema con datos de DB
 * /buscar  → Búsqueda activa (agente aislado)
 * /debug_resumen → Estado técnico detallado + telemetría Fase 2A
 */
import TelegramBot from "node-telegram-bot-api";
import { getConfig } from "../config/env";
import { createModuleLogger } from "../core/logger";
import { healthTracker } from "../core/healthcheck";
import { formatDuration, formatMexicoDate, nowISO } from "../core/time";
import { getState, STATE_KEYS } from "../core/system-state";
import { registerAgentCommands } from "../agent/telegram.commands";
import { getActiveRadars } from "../radars/index";

const log = createModuleLogger("commands");

let _bot: TelegramBot | null = null;

export function initCommandBot(): TelegramBot {
  if (_bot) return _bot;

  const config = getConfig();
  _bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });

  registerCommands(_bot, config.TELEGRAM_CHAT_ID);

  log.info("✅ Bot de comandos Telegram iniciado con polling");
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

// ─── Registro de comandos ─────────────────────────────────────────────────────

function registerCommands(bot: TelegramBot, chatId: string): void {
  // ── /prueba ──────────────────────────────────────────────────────────────
  bot.onText(/\/prueba/, async (msg) => {
    if (String(msg.chat.id) !== chatId) return;
    log.info(
      { from: msg.from?.username, chatId: msg.chat.id },
      "📥 Comando /prueba recibido",
    );

    try {
      const config = getConfig();
      const status = healthTracker.getStatus();
      const radars = getActiveRadars();

      const lastRunState = await getState<Record<string, unknown>>(
        STATE_KEYS.LAST_COLLECT_RUN,
      );
      const bootState = await getState<Record<string, unknown>>(
        STATE_KEYS.WORKER_BOOT_TIME,
      );
      const schedulerState = await getState<Record<string, unknown>>(
        STATE_KEYS.SCHEDULER_STATUS,
      );

      const dbIcon = statusIcon(status.services.database);
      const tgIcon = statusIcon(status.services.telegram);
      const workerIcon = statusIcon(status.overall);

      const schemaLine = status.dbSchemaValid
        ? `🧱 DB Schema: ✅ Válido (${status.schemaDetail.tablesFound}/${status.schemaDetail.tablesRequired} tablas)`
        : `🧱 DB Schema: ❌ INCOMPLETO (${status.schemaDetail.tablesFound}/${status.schemaDetail.tablesRequired} tablas)`;

      const schemaWarning =
        !status.dbSchemaValid && status.schemaDetail.missingList.length > 0
          ? `⚠️ Tablas faltantes: [${status.schemaDetail.missingList.join(", ")}]`
          : null;

      const lastCycle = lastRunState?.startedAt
        ? formatMexicoDate(String(lastRunState.startedAt))
        : status.lastCycleAt
          ? formatMexicoDate(status.lastCycleAt)
          : "Sin ciclos aún";

      const nextRun = nextRunEstimate(config.COLLECT_INTERVAL_MINUTES);
      const bootTime = bootState?.bootedAt
        ? formatMexicoDate(String(bootState.bootedAt))
        : "N/D";

      const schedulerStatusText =
        schedulerState?.status === "active" ? "✅ Activo" : "⏳ Iniciando";

      const lines = [
        `🔍 <b>ESTADO DEL SISTEMA — Radar Licitaciones MX</b>`,
        "",
        `🖥 Worker: <b>${workerIcon} ${serviceLabel(status.overall)}</b>`,
        `${dbIcon} Base de datos: <b>${serviceLabel(status.services.database)}</b>`,
        `  🔗 Conectada: <b>${status.dbConnected ? "Sí" : "No"}</b>`,
        schemaLine,
        schemaWarning,
        `${tgIcon} Telegram: <b>${serviceLabel(status.services.telegram)}</b>`,
        "",
        `⏰ Última corrida (last_cycle_at): <b>${lastCycle}</b>`,
        `🔜 Próxima corrida (next_cycle_at): ~<b>${nextRun} MX</b>`,
        `📡 Scheduler: <b>${schedulerStatusText}</b>`,
        `🛰 Radares activos (radars_count): <b>${radars.length}</b>`,
        "",
        `⏱ Uptime: <b>${formatDuration(status.uptimeMs)}</b>`,
        `🌍 Entorno (env): <b>${config.NODE_ENV}</b>`,
        `🚂 Railway: <b>${config.RAILWAY_ENVIRONMENT ?? "local"}</b>`,
        `🕐 Boot: ${bootTime}`,
        `🕐 Timestamp actual: ${formatMexicoDate(nowISO())}`,
        `🕒 Timezone: <b>${config.APP_TIMEZONE}</b>`,
        "",
        `⚙️ runtime_db_mode: <b>${status.runtimeDbMode}</b>`,
        `⚙️ uses_supabase_db_url_in_runtime: <b>false</b>`,
      ];

      await bot.sendMessage(chatId, lines.filter(Boolean).join("\n"), {
        parse_mode: "HTML",
      });

      log.info({ from: msg.from?.username }, "✅ /prueba respondido");
    } catch (err) {
      log.error({ err }, "❌ Error en /prueba");
      await bot
        .sendMessage(chatId, "❌ Error ejecutando /prueba — revisar logs")
        .catch(() => {});
    }
  });

  // ── Registro de comandos del Agente (aislado) ─────────────────────────────
  try {
    registerAgentCommands(bot, chatId);
  } catch (err) {
    log.error({ err }, "❌ Error registrando comandos del Agente — Radar continúa");
  }

  // ── /debug_resumen ────────────────────────────────────────────────────────
  // Muestra telemetría completa de Fase 2A: pages_scanned, stop_reason, known_streak,
  // detail_fetch_executed, skipped_by_fingerprint, totales y modo ejecutado.
  bot.onText(/\/debug_resumen/, async (msg) => {
    if (String(msg.chat.id) !== chatId) return;
    log.info(
      { from: msg.from?.username },
      "📥 Comando /debug_resumen recibido",
    );

    try {
      const status = healthTracker.getStatus();
      const lastRunState = await getState<Record<string, unknown>>(
        STATE_KEYS.LAST_COLLECT_RUN,
      );
      const bootState = await getState<Record<string, unknown>>(
        STATE_KEYS.WORKER_BOOT_TIME,
      );
      const schedulerState = await getState<Record<string, unknown>>(
        STATE_KEYS.SCHEDULER_STATUS,
      );
      const radars = getActiveRadars();

      // Modo ejecutado
      const modeRaw = lastRunState?.mode ?? "N/D";
      const modeLabel =
        modeRaw === "listing_scan"
          ? "⚡ MODO 1 — Listing Scan"
          : modeRaw === "daily_recheck"
            ? "🔄 MODO 2 — Daily Recheck"
            : `❓ ${modeRaw}`;

      const lines = [
        `🔧 <b>DEBUG RESUMEN — Radar Licitaciones MX</b>`,
        "",
        `<b>Servicios:</b>`,
        `  DB: ${status.services.database} | Telegram: ${status.services.telegram} | PW: ${status.services.playwright}`,
        "",
        `<b>Último ciclo:</b> ${status.lastCycleAt ? formatMexicoDate(status.lastCycleAt) : "N/A"}`,
        status.lastCycleDurationMs
          ? `<b>Duración:</b> ${formatDuration(status.lastCycleDurationMs)}`
          : "",
        `<b>Matches último ciclo:</b> ${status.lastCycleMatches ?? 0}`,
        "",
        `<b>⏱ System State (DB):</b>`,
        `  Boot: ${bootState?.bootedAt ? formatMexicoDate(String(bootState.bootedAt)) : "N/D"}`,
        `  Scheduler: ${schedulerState?.status ?? "N/D"}`,
        `  Último run: ${lastRunState?.startedAt ? formatMexicoDate(String(lastRunState.startedAt)) : "N/D"}`,
        `  Status: ${lastRunState?.status ?? "N/D"}`,
        `  Collector: ${lastRunState?.collectorKey ?? "N/D"}`,
        "",
        `<b>📊 Telemetría Fase 2A — ${modeLabel}:</b>`,
        `  pages_scanned: <b>${lastRunState?.pages_scanned ?? lastRunState?.pagesScanned ?? 0}</b>`,
        `  total_listing_rows_seen: <b>${lastRunState?.total_listing_rows_seen ?? 0}</b>`,
        `  detail_fetch_executed: <b>${lastRunState?.detail_fetch_executed ?? 0}</b>`,
        `  skipped_by_fingerprint: <b>${lastRunState?.skipped_by_fingerprint ?? 0}</b>`,
        `  total_new_detected: <b>${lastRunState?.total_new_detected ?? 0}</b>`,
        `  total_mutated_detected: <b>${lastRunState?.total_mutated_detected ?? 0}</b>`,
        `  total_attachments_checked: <b>${lastRunState?.total_attachments_checked ?? 0}</b>`,
        `  known_streak: <b>${lastRunState?.known_streak ?? 0}</b>`,
        `  stop_reason: <code>${String(lastRunState?.stop_reason ?? "N/D").slice(0, 200)}</code>`,
        "",
        `  itemsSeen: ${lastRunState?.itemsSeen ?? 0} | Created: ${lastRunState?.itemsCreated ?? 0} | Updated: ${lastRunState?.itemsUpdated ?? 0}`,
        "",
        // Error real — reflejado, no escondido
        lastRunState?.errorMessage
          ? `⚠️ <b>Error:</b> <code>${String(lastRunState.errorMessage).slice(0, 200)}</code>`
          : "",
        "",
        `<b>Radares activos:</b> ${radars.length}`,
        radars.map((r) => `  • ${r.key} (prio ${r.priority})`).join("\n"),
        "",
        `<b>Uptime:</b> ${formatDuration(status.uptimeMs)}`,
        `<b>Ahora:</b> ${formatMexicoDate(nowISO())}`,
      ];

      await bot.sendMessage(chatId, lines.filter(Boolean).join("\n"), {
        parse_mode: "HTML",
      });

      log.info({ from: msg.from?.username }, "✅ /debug_resumen respondido");
    } catch (err) {
      log.error({ err }, "❌ Error en /debug_resumen");
      // Reflejar el error real, no esconderlo
      await bot
        .sendMessage(
          chatId,
          `❌ Error ejecutando /debug_resumen:\n<code>${err instanceof Error ? err.message : String(err)}</code>`,
          { parse_mode: "HTML" },
        )
        .catch(() => {});
    }
  });

  log.info("✅ Comandos registrados: /prueba, /buscar (agente), /debug_resumen");
}
