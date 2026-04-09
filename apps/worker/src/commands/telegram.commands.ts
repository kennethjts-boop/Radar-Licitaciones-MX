/**
 * TELEGRAM COMMANDS — Bot listener y handlers.
 * Arranca polling solo cuando se inicializa.
 */
import TelegramBot from 'node-telegram-bot-api';
import { getConfig } from '../config/env';
import { createModuleLogger } from '../core/logger';
import { healthTracker } from '../core/healthcheck';
import { formatDuration, formatMexicoDate } from '../core/time';
import { searchProcurements } from '../storage/procurement.repo';
import { getLastCollectRun } from '../storage/collect-run.repo';

const log = createModuleLogger('commands');

let _bot: TelegramBot | null = null;

export function initCommandBot(): TelegramBot {
  if (_bot) return _bot;

  const config = getConfig();
  _bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });

  registerCommands(_bot, config.TELEGRAM_CHAT_ID);

  log.info('Bot de comandos Telegram iniciado con polling');
  return _bot;
}

function registerCommands(bot: TelegramBot, chatId: string): void {
  // ── /prueba ──────────────────────────────────────────────────────────────
  bot.onText(/\/prueba/, async (msg) => {
    if (String(msg.chat.id) !== chatId) return;
    log.info({ from: msg.from?.username }, 'Comando /prueba recibido');

    try {
      const status = healthTracker.getStatus();
      const lastRun = await getLastCollectRun('comprasmx');

      const lines = [
        `🔍 <b>ESTADO DEL SISTEMA — Radar Licitaciones MX</b>`,
        '',
        `🖥 Worker: <b>${status.overall === 'ok' ? '✅ OK' : status.overall === 'degraded' ? '⚠️ DEGRADADO' : '❌ CAÍDO'}</b>`,
        `🗄 Base de datos: <b>${status.services.database === 'ok' ? '✅ OK' : '❌ ERROR'}</b>`,
        `📨 Telegram: <b>${status.services.telegram === 'ok' ? '✅ OK' : '❌ ERROR'}</b>`,
        `🎭 Playwright: <b>${status.services.playwright === 'ok' ? '✅ OK' : '⚠️ No verificado'}</b>`,
        '',
        status.lastCycleAt
          ? `⏰ Última corrida: ${formatMexicoDate(status.lastCycleAt)}`
          : `⏰ Sin ciclos completados aún`,
        status.lastCycleDurationMs
          ? `⌛ Duración: ${formatDuration(status.lastCycleDurationMs)}`
          : '',
        status.lastCycleMatches !== null
          ? `🎯 Matches recientes: ${status.lastCycleMatches}`
          : '',
        '',
        `⏱ Uptime: ${formatDuration(status.uptimeMs)}`,
        `🕐 Verificado: ${formatMexicoDate(status.checkedAt)}`,
        lastRun
          ? `\n📦 Último run Compras MX: ${lastRun.status} — ${lastRun.items_seen} vistos, ${lastRun.items_created} nuevos`
          : '',
      ];

      await bot.sendMessage(chatId, lines.filter(Boolean).join('\n'), {
        parse_mode: 'HTML',
      });
    } catch (err) {
      log.error({ err }, 'Error en /prueba');
      await bot.sendMessage(chatId, '❌ Error ejecutando /prueba');
    }
  });

  // ── /buscar ──────────────────────────────────────────────────────────────
  bot.onText(/\/buscar (.+)/, async (msg, match) => {
    if (String(msg.chat.id) !== chatId) return;
    const query = match?.[1]?.trim();
    if (!query) {
      await bot.sendMessage(chatId, 'Uso: /buscar <texto>');
      return;
    }

    log.info({ query }, 'Comando /buscar recibido');

    try {
      const results = await searchProcurements(query, 5);

      if (results.length === 0) {
        await bot.sendMessage(chatId, `🔍 Sin resultados para: <b>${query}</b>`, {
          parse_mode: 'HTML',
        });
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
    } catch (err) {
      log.error({ err, query }, 'Error en /buscar');
      await bot.sendMessage(chatId, '❌ Error ejecutando búsqueda');
    }
  });

  // ── /debug_resumen ────────────────────────────────────────────────────────
  bot.onText(/\/debug_resumen/, async (msg) => {
    if (String(msg.chat.id) !== chatId) return;
    log.info({ from: msg.from?.username }, 'Comando /debug_resumen recibido');

    try {
      const status = healthTracker.getStatus();
      const lastRun = await getLastCollectRun('comprasmx');

      const lines = [
        `🔧 <b>DEBUG RESUMEN — Radar Licitaciones MX</b>`,
        '',
        `<b>Servicios:</b>`,
        `  DB: ${status.services.database} | Telegram: ${status.services.telegram} | PW: ${status.services.playwright}`,
        '',
        `<b>Último ciclo:</b> ${status.lastCycleAt ? formatMexicoDate(status.lastCycleAt) : 'N/A'}`,
        status.lastCycleDurationMs ? `<b>Duración:</b> ${formatDuration(status.lastCycleDurationMs)}` : '',
        '',
        '<b>Collector comprasmx:</b>',
        lastRun
          ? [
              `  Estatus: ${lastRun.status}`,
              `  Revisados: ${lastRun.items_seen}`,
              `  Creados: ${lastRun.items_created}`,
              `  Actualizados: ${lastRun.items_updated}`,
              lastRun.error_message ? `  ⚠️ Error: ${lastRun.error_message.slice(0, 100)}` : '',
            ]
              .filter(Boolean)
              .join('\n')
          : '  Sin datos de corridas',
        '',
        `<b>Matches última corrida:</b> ${status.lastCycleMatches ?? 'N/A'}`,
        `<b>Uptime:</b> ${formatDuration(status.uptimeMs)}`,
      ];

      await bot.sendMessage(chatId, lines.filter(Boolean).join('\n'), {
        parse_mode: 'HTML',
      });
    } catch (err) {
      log.error({ err }, 'Error en /debug_resumen');
      await bot.sendMessage(chatId, '❌ Error ejecutando /debug_resumen');
    }
  });

  log.info('Comandos registrados: /prueba, /buscar, /debug_resumen');
}
