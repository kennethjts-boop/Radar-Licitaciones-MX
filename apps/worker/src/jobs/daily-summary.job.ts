/**
 * DAILY SUMMARY JOB — Genera y envía el resumen de las últimas 24 horas.
 */
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../core/logger';
import { todayMexicoStr, nowISO } from '../core/time';
import { getSupabaseClient } from '../storage/client';
import { sendDailySummary } from '../alerts/telegram.alerts';
import type { DailySummary } from '../types/procurement';

const log = createModuleLogger('daily-summary-job');

export async function runDailySummaryJob(): Promise<void> {
  log.info('Generando resumen diario');

  const db = getSupabaseClient();
  const today = todayMexicoStr();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const since = yesterday.toISOString();

  try {
    // Contar expedientes vistos en las últimas 24h (por last_seen_at)
    const { count: totalSeen } = await db
      .from('procurements')
      .select('*', { count: 'exact', head: true })
      .gte('last_seen_at', since);

    const { count: totalNew } = await db
      .from('procurements')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since);

    // Expedientes cuyo updated_at > created_at (es decir, tuvieron al menos 1 actualización)
    const { count: totalUpdated } = await db
      .from('procurement_versions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since)
      .gt('version_number', 1);

    const { count: totalMatches } = await db
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since);

    const { count: totalAlerts } = await db
      .from('alerts')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since)
      .eq('telegram_status', 'sent');

    // Matches por radar
    const { data: matchData } = await db
      .from('matches')
      .select('radar_id')
      .gte('created_at', since);

    const matchesByRadar: Record<string, number> = {};
    (matchData ?? []).forEach((m) => {
      matchesByRadar[m.radar_id] = (matchesByRadar[m.radar_id] ?? 0) + 1;
    });

    // Top dependencias
    const { data: depsData } = await db
      .from('procurements')
      .select('dependency_name')
      .gte('last_seen_at', since)
      .not('dependency_name', 'is', null);

    const depCounts: Record<string, number> = {};
    (depsData ?? []).forEach((d) => {
      if (d.dependency_name) {
        depCounts[d.dependency_name] = (depCounts[d.dependency_name] ?? 0) + 1;
      }
    });
    const topDependencies = Object.entries(depCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const summary: DailySummary = {
      summaryDate: today,
      totalSeen: totalSeen ?? 0,
      totalNew: totalNew ?? 0,
      totalUpdated: totalUpdated ?? 0,
      totalMatches: totalMatches ?? 0,
      totalAlerts: totalAlerts ?? 0,
      matchesByRadar,
      topDependencies,
      technicalIncidents: [],
      telegramMessage: '',
    };

    // Guardar en DB
    await db.from('daily_summaries').insert({
      id: uuidv4(),
      summary_date: today,
      total_seen: summary.totalSeen,
      total_new: summary.totalNew,
      total_updated: summary.totalUpdated,
      total_matches: summary.totalMatches,
      total_alerts: summary.totalAlerts,
      summary_text: JSON.stringify(summary),
      created_at: nowISO(),
    });

    // Enviar a Telegram
    await sendDailySummary(summary);

    log.info({ today, totalSeen, totalNew, totalMatches }, 'Resumen diario enviado');
  } catch (err) {
    log.error({ err }, 'Error generando resumen diario');
  }
}
