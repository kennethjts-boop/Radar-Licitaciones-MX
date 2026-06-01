/**
 * DAILY SUMMARY JOB — Genera y envía el resumen de las últimas 24 horas.
 * Versión mejorada con secciones por categoría de alertabilidad.
 */
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../core/logger';
import { formatMexicoDate, mexicoDateAtHourISO, todayMexicoStr, nowISO } from '../core/time';
import { getSupabaseClient } from '../storage/client';
import { describeTelegramSendError, sendEnhancedDailySummary } from '../alerts/telegram.alerts';
import { buildSummaryData } from '../modules/alert-filter';
import { healthTracker } from '../core/healthcheck';
import { getConfig } from '../config/env';
import { setState, STATE_KEYS } from '../core/system-state';

const log = createModuleLogger('daily-summary-job');

function buildFailureReason(err: unknown): {
  message: string;
  telegramRespondedError: boolean;
  telegramTimeout: boolean;
  telegramNetworkError: boolean;
  telegramApiError: boolean;
} {
  const baseMessage = err instanceof Error ? err.message : String(err);
  const details = describeTelegramSendError(err);

  if (details.kind === 'unknown') {
    return {
      message: baseMessage,
      telegramRespondedError: /telegram/i.test(baseMessage),
      telegramTimeout: false,
      telegramNetworkError: false,
      telegramApiError: false,
    };
  }

  const fragments = [
    `telegram_${details.kind}`,
    details.statusCode !== undefined ? `status=${details.statusCode}` : null,
    details.apiErrorCode !== undefined ? `api_error_code=${details.apiErrorCode}` : null,
    details.code ? `code=${details.code}` : null,
    details.apiDescription ? `description=${details.apiDescription}` : null,
    `reason=${details.summary}`,
  ].filter(Boolean);

  return {
    message: fragments.join(' | '),
    telegramRespondedError: details.kind === 'api',
    telegramTimeout: details.kind === 'timeout',
    telegramNetworkError: details.kind === 'network',
    telegramApiError: details.kind === 'api',
  };
}

export async function runDailySummaryJob(): Promise<void> {
  log.info('Generando resumen diario mejorado');

  const config = getConfig();
  const today = todayMexicoStr();
  const expectedAt = mexicoDateAtHourISO(today, config.DAILY_SUMMARY_HOUR);
  const startedAt = nowISO();

  await setState(STATE_KEYS.LAST_DAILY_SUMMARY, {
    status: 'running',
    summaryDate: today,
    expectedAt,
    expectedAtMx: formatMexicoDate(expectedAt),
    startedAt,
    finishedAt: null,
    actualAt: startedAt,
    telegramMessageId: null,
    chatConfigured: Boolean(config.TELEGRAM_CHAT_ID),
    skippedByDedup: false,
    failureReason: null,
  });

  try {
    const summaryData = await buildSummaryData();

    const healthStatus = healthTracker.getStatus();
    if (healthStatus.services.database !== 'ok') {
      summaryData.technicalIncidents.push('DB con problemas de conectividad en algún ciclo');
    }

    // Guardar en DB (formato legado compatible)
    const db = getSupabaseClient();
    const totalMatchesDeduped = new Set([
      ...summaryData.newActive.map(s => s.externalId),
      ...summaryData.recentDesierta.map(s => s.externalId),
      ...summaryData.soonExpiring.map(s => s.externalId),
      ...summaryData.highScore.map(s => s.externalId),
    ]).size;
    const { error: insertErr } = await db.from('daily_summaries').insert({
      id: uuidv4(),
      summary_date: today,
      total_seen: summaryData.totalSeen,
      total_new: summaryData.totalNew,
      total_updated: 0,
      total_matches: totalMatchesDeduped,
      total_alerts: summaryData.totalAlerts,
      summary_text: JSON.stringify(summaryData),
      created_at: nowISO(),
    });
    if (insertErr) {
      log.warn({ err: insertErr }, 'No se pudo guardar resumen en DB; continuando con envío Telegram');
      summaryData.technicalIncidents.push('Error al guardar resumen en DB');
    }

    // Enviar a Telegram con nuevo formato de secciones
    const telegramMessageId = await sendEnhancedDailySummary(summaryData);
    const finishedAt = nowISO();

    await setState(STATE_KEYS.LAST_DAILY_SUMMARY, {
      status: 'success',
      summaryDate: today,
      expectedAt,
      expectedAtMx: formatMexicoDate(expectedAt),
      startedAt,
      finishedAt,
      actualAt: finishedAt,
      telegramMessageId,
      chatConfigured: Boolean(config.TELEGRAM_CHAT_ID),
      skippedByDedup: false,
      failureReason: null,
      totalSeen: summaryData.totalSeen,
      totalNew: summaryData.totalNew,
      totalAlerts: summaryData.totalAlerts,
      newActive: summaryData.newActive.length,
      recentDesierta: summaryData.recentDesierta.length,
      soonExpiring: summaryData.soonExpiring.length,
      highScore: summaryData.highScore.length,
      technicalIncidents: summaryData.technicalIncidents,
    });

    log.info(
      {
        today,
        newActive: summaryData.newActive.length,
        recentDesierta: summaryData.recentDesierta.length,
        soonExpiring: summaryData.soonExpiring.length,
        highScore: summaryData.highScore.length,
        excluded: summaryData.excludedCount,
      },
      'Resumen diario enviado',
    );
  } catch (err) {
    const failure = buildFailureReason(err);
    const finishedAt = nowISO();
    await setState(STATE_KEYS.LAST_DAILY_SUMMARY, {
      status: 'error',
      summaryDate: today,
      expectedAt,
      expectedAtMx: formatMexicoDate(expectedAt),
      startedAt,
      finishedAt,
      actualAt: finishedAt,
      telegramMessageId: null,
      chatConfigured: Boolean(config.TELEGRAM_CHAT_ID),
      skippedByDedup: false,
      failureReason: failure.message,
      telegramRespondedError: failure.telegramRespondedError,
      telegramTimeout: failure.telegramTimeout,
      telegramNetworkError: failure.telegramNetworkError,
      telegramApiError: failure.telegramApiError,
    });
    log.error({ err, expectedAt, actualAt: finishedAt, failureReason: failure.message }, 'Error generando resumen diario');
  }
}
