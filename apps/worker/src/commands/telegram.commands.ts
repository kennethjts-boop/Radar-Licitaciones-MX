/**
 * TELEGRAM COMMANDS — Bot listener y handlers.
 * Arranca polling solo cuando se inicializa.
 *
 * /prueba  → Estado real del sistema con datos de DB
 * /buscar  → Búsqueda en expedientes
 * /debug_resumen → Estado técnico detallado
 */
import TelegramBot from 'node-telegram-bot-api';
import { getConfig } from '../config/env';
import { createModuleLogger } from '../core/logger';
import { healthTracker } from '../core/healthcheck';
import { formatDuration, formatMexicoDate, nowISO } from '../core/time';
import { getState, STATE_KEYS } from '../core/system-state';
import { searchProcurements } from '../storage/procurement.repo';
import { getActiveRadars } from '../radars/index';

const log = createModuleLogger('commands');

let _bot: TelegramBot | null = null;

export function initCommandBot(): TelegramBot {
  if (_bot) return _bot;

  const config = getConfig();
  _bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });

  registerCommands(_bot, config.TELEGRAM_CHAT_ID);

  log.info('✅ Bot de comandos Telegram iniciado con polling');
  return _bot;
}

export function getCommandBot(): TelegramBot | null {
  return _bot;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusIcon(status: 'ok' | 'degraded' | 'down' | 'unknown'): string {
  if (status === 'ok') return '✅';
  if (status === 'degraded') return '⚠️';
  if (status === 'down') return '❌';
  return '⬛'; // unknown
}

function serviceLabel(status: 'ok' | 'degraded' | 'down' | 'unknown'): string {
  if (status === 'ok') return 'OK';
  if (status === 'degraded') return 'DEGRADADO';
  if (status === 'down') return 'CAÍDO';
  return 'DESCONOCIDO';
}

// Calcula la próxima ejecución del cron basado en el intervalo
function nextRunEstimate(intervalMinutes: number): string {
  const now = new Date();
  const minutesPast = now.getMinutes() % intervalMinutes;
  const minutesUntilNext = intervalMinutes - minutesPast;
  const next = new Date(now.getTime() + minutesUntilNext * 60 * 1000);
  next.setSeconds(0, 0);
  return formatMexicoDate(next.toISOString(), 'HH:mm');
}

// ─── Registro de comandos ─────────────────────────────────────────────────────

function registerCommands(bot: TelegramBot, chatId: string): void {

  // ── /prueba ──────────────────────────────────────────────────────────────
  bot.onText(/\/prueba/, async (msg) => {
    if (String(msg.chat.id) !== chatId) return;
    log.info({ from: msg.from?.username, chatId: msg.chat.id }, '📥 Comando /prueba recibido');

    try {
      const config = getConfig();
      const status = healthTracker.getStatus();
      const radars = getActiveRadars();

      // Leer estado real desde DB
      const lastRunState = await getState<Record<string, unknown>>(STATE_KEYS.LAST_COLLECT_RUN);
      const bootState = await getState<Record<string, unknown>>(STATE_KEYS.WORKER_BOOT_TIME);
      const schedulerState = await getState<Record<string, unknown>>(STATE_KEYS.SCHEDULER_STATUS);

      const dbIcon = statusIcon(status.services.database);
      const tgIcon = statusIcon(status.services.telegram);
      const workerIcon = statusIcon(status.overall);

      const schemaLine = status.dbSchemaValid
        ? `🧱 DB Schema: ✅ Válido (${status.schemaDetail.tablesFound}/${status.schemaDetail.tablesRequired} tablas)`
        : `🧱 DB Schema: ❌ INCOMPLETO (${status.schemaDetail.tablesFound}/${status.schemaDetail.tablesRequired} tablas)`;

      const schemaWarning = !status.dbSchemaValid && status.schemaDetail.missingList.length > 0
        ? `⚠️ Tablas faltantes: [${status.schemaDetail.missingList.join(', ')}]`
        : null;

      const lastCycle = lastRunState?.startedAt
        ? formatMexicoDate(String(lastRunState.startedAt))
        : status.lastCycleAt
        ? formatMexicoDate(status.lastCycleAt)
        : 'Sin ciclos aún';

      const nextRun = nextRunEstimate(config.COLLECT_INTERVAL_MINUTES);
      const bootTime = bootState?.bootedAt
        ? formatMexicoDate(String(bootState.bootedAt))
        : 'N/D';

      const schedulerStatusText =
        schedulerState?.status === 'active' ? '✅ Activo' : '⏳ Iniciando';

      const lines = [
        `🔍 <b>ESTADO DEL SISTEMA — Radar Licitaciones MX</b>`,
        '',
        `🖥 Worker: <b>${workerIcon} ${serviceLabel(status.overall)}</b>`,
        `${dbIcon} Base de datos: <b>${serviceLabel(status.services.database)}</b>`,
        `  🔗 Conectada: <b>${status.dbConnected ? 'Sí' : 'No'}</b>`,
        schemaLine,
        schemaWarning,
        `${tgIcon} Telegram: <b>${serviceLabel(status.services.telegram)}</b>`,
        '',
        `⏰ Última corrida (last_cycle_at): <b>${lastCycle}</b>`,
        `🔜 Próxima corrida (next_cycle_at): ~<b>${nextRun} MX</b>`,
        `📡 Scheduler: <b>${schedulerStatusText}</b>`,
        `🛰 Radares activos (radars_count): <b>${radars.length}</b>`,
        '',
        `⏱ Uptime: <b>${formatDuration(status.uptimeMs)}</b>`,
        `🌍 Entorno (env): <b>${config.NODE_ENV}</b>`,
        `🚂 Railway: <b>${config.RAILWAY_ENVIRONMENT ?? 'local'}</b>`,
        `🕐 Boot: ${bootTime}`,
        `🕐 Timestamp actual: ${formatMexicoDate(nowISO())}`,
        `🕒 Timezone: <b>${config.APP_TIMEZONE}</b>`,
        '',
        `⚙️ runtime_db_mode: <b>${status.runtimeDbMode}</b>`,
        `⚙️ uses_supabase_db_url_in_runtime: <b>false</b>`,
      ];

      await bot.sendMessage(chatId, lines.filter(Boolean).join('\n'), {
        parse_mode: 'HTML',
      });

      log.info({ from: msg.from?.username }, '✅ /prueba respondido');
    } catch (err) {
      log.error({ err }, '❌ Error en /prueba');
      await bot.sendMessage(chatId, '❌ Error ejecutando /prueba — revisar logs').catch(() => {});
    }
  });

  // ── /buscar ──────────────────────────────────────────────────────────────
  bot.onText(/\/buscar (.+)/, async (msg, match) => {
    if (String(msg.chat.id) !== chatId) return;
    const query = match?.[1]?.trim();
    if (!query) {
      await bot.sendMessage(chatId, 'Uso: /buscar <texto o número de expediente>');
      return;
    }

    log.info({ query, from: msg.from?.username }, '📥 Comando /buscar recibido');

    try {
      const results = await searchProcurements(query, 5);

      if (results.length === 0) {
        await bot.sendMessage(
          chatId,
          `🔍 Sin resultados para: <b>${query}</b>\n\n<i>La base de datos puede estar vacía hasta Fase 2.</i>`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const lines = [
        `🔍 <b>Resultados para: "${query}"</b>`,
        `(${results.length} encontrados)\n`,
      ];

      for (const r of results) {
        lines.push(`📋 <b>${r.title}</b>`);
        lines.push(`   Exp: ${r.expediente_id ?? 'N/D'} | ${r.status}`);
        lines.push(`   ${r.dependency_name ?? 'Sin dependencia'}`);
        lines.push(`   <a href="${r.source_url}">Ver expediente</a>`);
        lines.push('');
      }

      await bot.sendMessage(chatId, lines.join('\n'), {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      log.info({ query, count: results.length }, '✅ /buscar respondido');
    } catch (err) {
      log.error({ err, query }, '❌ Error en /buscar');
      await bot.sendMessage(chatId, '❌ Error ejecutando búsqueda').catch(() => {});
    }
  });

  // ── /debug_resumen ────────────────────────────────────────────────────────
  bot.onText(/\/debug_resumen/, async (msg) => {
    if (String(msg.chat.id) !== chatId) return;
    log.info({ from: msg.from?.username }, '📥 Comando /debug_resumen recibido');

    try {
      const status = healthTracker.getStatus();
      const lastRunState = await getState<Record<string, unknown>>(STATE_KEYS.LAST_COLLECT_RUN);
      const bootState = await getState<Record<string, unknown>>(STATE_KEYS.WORKER_BOOT_TIME);
      const schedulerState = await getState<Record<string, unknown>>(STATE_KEYS.SCHEDULER_STATUS);
      const radars = getActiveRadars();

      const lines = [
        `🔧 <b>DEBUG RESUMEN — Radar Licitaciones MX</b>`,
        '',
        `<b>Servicios:</b>`,
        `  DB: ${status.services.database} | Telegram: ${status.services.telegram} | PW: ${status.services.playwright}`,
        '',
        `<b>Último ciclo:</b> ${status.lastCycleAt ? formatMexicoDate(status.lastCycleAt) : 'N/A'}`,
        status.lastCycleDurationMs ? `<b>Duración:</b> ${formatDuration(status.lastCycleDurationMs)}` : '',
        `<b>Matches último ciclo:</b> ${status.lastCycleMatches ?? 0}`,
        '',
        `<b>System state (DB):</b>`,
        `  Boot: ${bootState?.bootedAt ? formatMexicoDate(String(bootState.bootedAt)) : 'N/D'}`,
        `  Scheduler: ${schedulerState?.status ?? 'N/D'}`,
        `  Último run: ${lastRunState?.startedAt ? formatMexicoDate(String(lastRunState.startedAt)) : 'N/D'}`,
        `  Run status: ${lastRunState?.status ?? 'N/D'}`,
        `  Collector: ${lastRunState?.collectorKey ?? 'N/D'}`,
        `  Pages Scanned: ${lastRunState?.pagesScanned ?? 0}`,
        `  Items Seen: ${lastRunState?.itemsSeen ?? 0}`,
        `  Items Created: ${lastRunState?.itemsCreated ?? 0}`,
        `  Items Updated: ${lastRunState?.itemsUpdated ?? 0}`,
        lastRunState?.errorMessage ? `  ⚠️ Stop Reason/Error: ${String(lastRunState.errorMessage).slice(0, 150)}` : '',
        '',
        `<b>Radares activos:</b> ${radars.length}`,
        radars.map((r) => `  • ${r.key} (prio ${r.priority})`).join('\n'),
        '',
        `<b>Uptime:</b> ${formatDuration(status.uptimeMs)}`,
        `<b>Ahora:</b> ${formatMexicoDate(nowISO())}`,
      ];

      await bot.sendMessage(chatId, lines.filter(Boolean).join('\n'), {
        parse_mode: 'HTML',
      });

      log.info({ from: msg.from?.username }, '✅ /debug_resumen respondido');
    } catch (err) {
      log.error({ err }, '❌ Error en /debug_resumen');
      await bot.sendMessage(chatId, '❌ Error ejecutando /debug_resumen').catch(() => {});
    }
  });

  log.info('✅ Comandos registrados: /prueba, /buscar, /debug_resumen');
}
