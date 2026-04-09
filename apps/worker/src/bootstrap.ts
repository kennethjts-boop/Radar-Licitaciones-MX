/**
 * BOOTSTRAP — Secuencia de arranque del worker.
 *
 * Orden de arranque:
 * 1. Validar env (ya hecho por Zod en config/env)
 * 2. Verificar conectividad con Supabase
 * 3. Verificar conectividad con Telegram (getMe)
 * 4. Actualizar healthcheck en memoria
 * 5. Registrar boot en system_state
 * 6. Enviar mensaje de arranque a Telegram (si está disponible)
 *
 * Política de fallos:
 * - Si Supabase falla → continúa con advertencia (worker funciona sin DB al arrancar)
 * - Si Telegram falla → continúa con advertencia
 * - Si falla env → crash inmediato (ya gestionado por Zod)
 *
 * La razón de no crashear por DB/Telegram en boot es que Railway puede reiniciar
 * el proceso antes de que los servicios downstream estén listos.
 */
import TelegramBot from 'node-telegram-bot-api';
import { getConfig } from './config/env';
import { createModuleLogger } from './core/logger';
import { healthTracker } from './core/healthcheck';
import { recordWorkerBoot, recordHealthcheck } from './core/system-state';
import { nowISO, formatMexicoDate } from './core/time';
import { getActiveRadars } from './radars/index';

const log = createModuleLogger('bootstrap');

export interface BootstrapResult {
  supabaseOk: boolean;
  telegramOk: boolean;
  botUsername: string | null;
  sourceId: string | null;          // ID de la fuente comprasmx en Supabase
  bootedAt: string;
}

// ─── Check Supabase ───────────────────────────────────────────────────────────

async function checkSupabase(): Promise<{ ok: boolean; sourceId: string | null }> {
  try {
    const { getSupabaseClient } = await import('./storage/client');
    const db = getSupabaseClient();

    // Leer la fuente comprasmx — valida conectividad y la existencia del seed
    const { data, error } = await db
      .from('sources')
      .select('id, key, name')
      .eq('key', 'comprasmx')
      .single();

    if (error) {
      log.error({ error: error.message }, '❌ Supabase: error al leer tabla sources');
      return { ok: false, sourceId: null };
    }

    if (!data) {
      log.warn('⚠️ Supabase: tabla sources existe pero no hay seed para comprasmx');
      return { ok: true, sourceId: null };
    }

    log.info({ sourceKey: data.key, sourceName: data.name }, '✅ Supabase: conectado');
    return { ok: true, sourceId: data.id };
  } catch (err) {
    log.error({ err }, '❌ Supabase: no se pudo conectar');
    return { ok: false, sourceId: null };
  }
}

// ─── Check Telegram ───────────────────────────────────────────────────────────

async function checkTelegram(token: string): Promise<{ ok: boolean; username: string | null }> {
  try {
    // Usar un bot sin polling solo para validar el token
    const bot = new TelegramBot(token, { polling: false });
    const me = await bot.getMe();
    log.info({ username: me.username, id: me.id }, '✅ Telegram: bot verificado');
    return { ok: true, username: me.username ?? null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg }, '❌ Telegram: error verificando bot');
    return { ok: false, username: null };
  }
}

// ─── Mensaje de boot ──────────────────────────────────────────────────────────

async function sendBootMessage(
  token: string,
  chatId: string,
  result: BootstrapResult
): Promise<void> {
  try {
    const bot = new TelegramBot(token, { polling: false });
    const config = getConfig();
    const radars = getActiveRadars();

    const dbStatusLine = result.supabaseOk
      ? '🗄 DB: ✅ Conectada'
      : '🗄 DB: ❌ Sin conexión';

    const tgStatusLine = result.telegramOk
      ? `📨 Bot: ✅ @${result.botUsername}`
      : '📨 Bot: ❌ Error';

    const message = [
      `🚀 <b>Worker iniciado — Radar Licitaciones MX</b>`,
      '',
      `🌍 Entorno: <b>${config.NODE_ENV}</b>`,
      `🚂 Railway: <b>${config.RAILWAY_ENVIRONMENT ?? 'local'}</b>`,
      dbStatusLine,
      tgStatusLine,
      `📡 Radares activos: <b>${radars.length}</b>`,
      `⏱ Scheduler: cada <b>${config.COLLECT_INTERVAL_MINUTES} min</b>`,
      `🕐 Boot: ${formatMexicoDate(result.bootedAt)}`,
      '',
      result.supabaseOk && result.telegramOk
        ? '✅ Sistema listo — esperando primer ciclo'
        : '⚠️ Sistema iniciado con advertencias — revisar logs',
    ].join('\n');

    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    log.info('📩 Mensaje de boot enviado a Telegram');
  } catch (err) {
    log.warn({ err }, 'No se pudo enviar mensaje de boot — continuando');
  }
}

// ─── Bootstrap principal ──────────────────────────────────────────────────────

export async function bootstrap(): Promise<BootstrapResult> {
  const config = getConfig();
  const bootedAt = nowISO();

  log.info('🔧 Iniciando bootstrap...');

  // 1. Check Supabase
  const { ok: supabaseOk, sourceId } = await checkSupabase();
  healthTracker.setDbHealth(supabaseOk ? 'ok' : 'down');

  // 2. Check Telegram
  const { ok: telegramOk, username: botUsername } = await checkTelegram(config.TELEGRAM_BOT_TOKEN);
  healthTracker.setTelegramHealth(telegramOk ? 'ok' : 'down');

  const result: BootstrapResult = {
    supabaseOk,
    telegramOk,
    botUsername,
    sourceId,
    bootedAt,
  };

  // 3. Registrar en system_state (no crashea si falla)
  if (supabaseOk) {
    await recordWorkerBoot('0.1.0');
    await recordHealthcheck(supabaseOk && telegramOk);
  }

  // 4. Enviar mensaje de boot a Telegram
  if (telegramOk) {
    await sendBootMessage(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID, result);
  }

  // 5. Log resumen del bootstrap
  log.info(
    {
      supabaseOk,
      telegramOk,
      botUsername,
      sourceId,
      radarsActive: getActiveRadars().length,
    },
    supabaseOk && telegramOk
      ? '✅ Bootstrap completado — all systems go'
      : '⚠️ Bootstrap completado con advertencias'
  );

  return result;
}
