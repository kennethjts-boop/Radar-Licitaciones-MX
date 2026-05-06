/**
 * DAILY SUMMARY JOB — Genera y envía el resumen de las últimas 24 horas.
 * Versión mejorada con secciones por categoría de alertabilidad.
 */
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../core/logger';
import { todayMexicoStr, nowISO } from '../core/time';
import { getSupabaseClient } from '../storage/client';
import { sendEnhancedDailySummary } from '../alerts/telegram.alerts';
import { buildSummaryData } from '../modules/alert-filter';
import { healthTracker } from '../core/healthcheck';

const log = createModuleLogger('daily-summary-job');

export async function runDailySummaryJob(): Promise<void> {
  log.info('Generando resumen diario mejorado');

  const today = todayMexicoStr();

  try {
    const summaryData = await buildSummaryData();

    const healthStatus = healthTracker.getStatus();
    if (healthStatus.services.database !== 'ok') {
      summaryData.technicalIncidents.push('DB con problemas de conectividad en algún ciclo');
    }

    // Guardar en DB (formato legado compatible)
    const db = getSupabaseClient();
    const { error: insertErr } = await db.from('daily_summaries').insert({
      id: uuidv4(),
      summary_date: today,
      total_seen: summaryData.totalSeen,
      total_new: summaryData.totalNew,
      total_updated: 0,
      total_matches: summaryData.highScore.length,
      total_alerts: summaryData.totalAlerts,
      summary_text: JSON.stringify(summaryData),
      created_at: nowISO(),
    });
    if (insertErr) {
      log.warn({ err: insertErr }, 'No se pudo guardar resumen en DB; continuando con envío Telegram');
      summaryData.technicalIncidents.push('Error al guardar resumen en DB');
    }

    // Enviar a Telegram con nuevo formato de secciones
    await sendEnhancedDailySummary(summaryData);

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
    log.error({ err }, 'Error generando resumen diario');
  }
}
