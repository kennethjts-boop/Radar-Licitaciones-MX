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
import { withTimeout } from "../core/errors";
import { formatCurrency } from "../core/text";
import { getState, STATE_KEYS } from "../core/system-state";
import { getActiveRadars } from "../radars/index";

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

      const lastRunState = await getState<Record<string, unknown>>(STATE_KEYS.LAST_COLLECT_RUN);
      const externalState = await getState<Record<string, unknown>>(STATE_KEYS.LAST_EXTERNAL_LEADS_RUN);
      const bootState = await getState<Record<string, unknown>>(STATE_KEYS.WORKER_BOOT_TIME);
      const schedulerState = await getState<Record<string, unknown>>(STATE_KEYS.SCHEDULER_STATUS);

      const dbIcon = statusIcon(status.services.database);
      const tgIcon = statusIcon(status.services.telegram);
      const workerIcon = statusIcon(status.overall);

      const nextRun = nextRunEstimate(config.COLLECT_INTERVAL_MINUTES);
      const bootTime = bootState?.bootedAt ? formatMexicoDate(String(bootState.bootedAt)) : "N/D";
      const lastRunFormatted = lastRunState?.startedAt
        ? formatMexicoDate(String(lastRunState.startedAt))
        : "Sin ejecución registrada todavía";
      const lastRunDisplay = lastRunFormatted === "Fecha inválida"
        ? "Sin ejecución registrada todavía"
        : lastRunFormatted;

      const stalledLine = status.stalled
        ? [`⚠️ <b>SIN CICLOS: +${Math.floor((status.stalledForMs ?? 0) / 60_000)} min — revisar scheduler</b>`]
        : [];
      const lastCycleErrorLine = status.lastCycleStatus === "error"
        ? ["⚠️ <b>Último ciclo terminó con error — revisar /debug_resumen</b>"]
        : [];

      const external =
        status.externalLeads.status !== "none" ? status.externalLeads : externalState;

      const lines = [
        `🔍 <b>ESTADO — Radar Licitaciones MX</b>`,
        "",
        `🖥 Worker: <b>${workerIcon} ${serviceLabel(status.overall)}</b>`,
        `${dbIcon} DB: <b>${serviceLabel(status.services.database)}</b> (${status.dbConnected ? "Conectada" : "Desconectada"})`,
        `🧱 Schema: <b>${status.dbSchemaValid ? "Válido" : "Inválido"}</b>`,
        `${tgIcon} Telegram: <b>${serviceLabel(status.services.telegram)}</b>`,
        ...stalledLine,
        ...lastCycleErrorLine,
        "",
        `⏰ Última: <b>${lastRunDisplay}</b>`,
        `🔜 Próxima: ~<b>${nextRun} MX</b>`,
        `📡 Scheduler: <b>${status.schedulerStatus === "active" || schedulerState?.status === "active" ? "✅ Activo" : "⏳ Iniciando"}</b>`,
        `🛰 Radares: <b>${radars.length} activos</b>`,
        `🧭 External OSINT: <b>${config.ENABLE_EXTERNAL_LEADS_OSINT ? "activo" : "inactivo"}</b> | Dry run: <b>${formatBool(config.EXTERNAL_LEADS_DRY_RUN)}</b>`,
        external
          ? `   Último: <b>${external.status ?? "N/D"}</b> | Detectados: <b>${external.detected ?? 0}</b> | Guardados: <b>${external.saved ?? 0}</b> | Alertas: <b>${external.alerted ?? 0}</b>`
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
      const lastRunState = await getState<Record<string, unknown>>(STATE_KEYS.LAST_COLLECT_RUN);
      const externalState = await getState<Record<string, unknown>>(STATE_KEYS.LAST_EXTERNAL_LEADS_RUN);
      const config = getConfig();
      const radars = getActiveRadars();
      const external =
        status.externalLeads.status !== "none" ? status.externalLeads : externalState;

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
        `<b>🧭 External OSINT:</b> ${config.ENABLE_EXTERNAL_LEADS_OSINT ? "activo" : "inactivo"}`,
        `  Dry run: <b>${formatBool(config.EXTERNAL_LEADS_DRY_RUN)}</b>`,
        `  Último ciclo: <b>${external?.status ?? "N/D"}</b>`,
        `  Fuentes: <b>${external?.sourcesReviewed ?? 0}</b>`,
        `  Detectados: <b>${external?.detected ?? 0}</b>`,
        `  Guardados: <b>${external?.saved ?? 0}</b>`,
        `  Alertas: <b>${external?.alerted ?? 0}</b>`,
        `  Errores: <b>${Array.isArray(external?.errors) ? external.errors.length : 0}</b>`,
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

  log.info("telegram_handlers_registered");
  log.info("✅ Comandos registrados: /prueba, /estado, /radares, /buscar, /monto, /debug_resumen, /scan, /recuperar, /techo");
}
