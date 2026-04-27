/**
 * TELEGRAM COMMANDS — Bot listener y handlers.
 * Esta versión elimina todas las referencias obsoletas para desbloquear CI.
 *
 * /prueba        → Estado real del sistema
 * /buscar        → Búsqueda en expedientes
 * /debug_resumen → Telemetría detallada Fase 2A
 */
import TelegramBot from "node-telegram-bot-api";
import { getConfig } from "../config/env";
import { createModuleLogger } from "../core/logger";
import { healthTracker } from "../core/healthcheck";
import { formatDuration, formatMexicoDate, nowISO } from "../core/time";
import { getState, STATE_KEYS } from "../core/system-state";
import { getActiveRadars } from "../radars/index";

const log = createModuleLogger("commands");

let _bot: TelegramBot | null = null;

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
    log.info({ from: msg.from?.username }, "📥 /prueba");

    try {
      const config = getConfig();
      const status = healthTracker.getStatus();
      const radars = getActiveRadars();

      const lastRunState = await getState<Record<string, unknown>>(STATE_KEYS.LAST_COLLECT_RUN);
      const bootState = await getState<Record<string, unknown>>(STATE_KEYS.WORKER_BOOT_TIME);
      const schedulerState = await getState<Record<string, unknown>>(STATE_KEYS.SCHEDULER_STATUS);

      const dbIcon = statusIcon(status.services.database);
      const tgIcon = statusIcon(status.services.telegram);
      const workerIcon = statusIcon(status.overall);

      const nextRun = nextRunEstimate(config.COLLECT_INTERVAL_MINUTES);
      const bootTime = bootState?.bootedAt ? formatMexicoDate(String(bootState.bootedAt)) : "N/D";

      const lines = [
        `🔍 <b>ESTADO — Radar Licitaciones MX</b>`,
        "",
        `🖥 Worker: <b>${workerIcon} ${serviceLabel(status.overall)}</b>`,
        `${dbIcon} DB: <b>${serviceLabel(status.services.database)}</b> (${status.dbConnected ? "Conectada" : "Desconectada"})`,
        `🧱 Schema: <b>${status.dbSchemaValid ? "Válido" : "Inválido"}</b>`,
        `${tgIcon} Telegram: <b>${serviceLabel(status.services.telegram)}</b>`,
        "",
        `⏰ Última: <b>${lastRunState?.startedAt ? formatMexicoDate(String(lastRunState.startedAt)) : "Sin ciclos"}</b>`,
        `🔜 Próxima: ~<b>${nextRun} MX</b>`,
        `📡 Scheduler: <b>${schedulerState?.status === "active" ? "✅ Activo" : "⏳ Iniciando"}</b>`,
        `🛰 Radares: <b>${radars.length} activos</b>`,
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
        .order("last_seen_at", { ascending: false })
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

  // ── /debug_resumen ────────────────────────────────────────────────────────
  bot.onText(/\/debug_resumen/, async (msg) => {
    if (String(msg.chat.id) !== chatId) return;
    log.info({ from: msg.from?.username }, "📥 /debug_resumen");

    try {
      const status = healthTracker.getStatus();
      const lastRunState = await getState<Record<string, unknown>>(STATE_KEYS.LAST_COLLECT_RUN);
      const radars = getActiveRadars();

      const lines = [
        `🔧 <b>TELEMETRÍA — Radar Licitaciones MX</b>`,
        "",
        `<b>Ciclo:</b> ${status.lastCycleAt ? formatMexicoDate(status.lastCycleAt) : "N/A"}`,
        `<b>Status:</b> ${lastRunState?.status ?? "N/D"} | <b>Mode:</b> ${lastRunState?.mode ?? "N/D"}`,
        "",
        `<b>📊 Indicadores Fase 2A:</b>`,
        `  Pages: <b>${lastRunState?.pages_scanned ?? 0}</b>`,
        `  Seen: <b>${lastRunState?.total_listing_rows_seen ?? 0}</b>`,
        `  Fetched: <b>${lastRunState?.detail_fetch_executed ?? 0}</b>`,
        `  Skipped: <b>${lastRunState?.skipped_by_fingerprint ?? 0}</b>`,
        `  New: <b>${lastRunState?.total_new_detected ?? 0}</b>`,
        `  Mutated: <b>${lastRunState?.total_mutated_detected ?? 0}</b>`,
        `  Streak: <b>${lastRunState?.known_streak ?? 0}</b>`,
        `  Stop: <code>${String(lastRunState?.stop_reason ?? "N/D").slice(0, 50)}</code>`,
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
    if (String(msg.chat.id) !== chatId) return;
    log.info({ from: msg.from?.username }, "📥 /scan");

    try {
      const { runCollectJob } = await import("../jobs/collect.job");
      // Ejecutar en background para no bloquear el bot
      runCollectJob().catch((err: unknown) => {
        log.error({ err }, "Error en ejecución de /scan");
      });
      await bot.sendMessage(chatId, "🚀 Escaneo manual de ComprasMX iniciado...").catch(() => {});
    } catch (err) {
      log.error({ err }, "❌ Error inicializando /scan");
      await bot.sendMessage(chatId, "❌ Error iniciando escaneo manual").catch(() => {});
    }
  });

  // ── /recuperar ──────────────────────────────────────────────────────────
  bot.onText(/\/recuperar/, async (msg) => {
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

  log.info("✅ Comandos registrados: /prueba, /buscar, /debug_resumen, /scan, /recuperar");
}
