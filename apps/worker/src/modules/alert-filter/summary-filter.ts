import { getSupabaseClient } from '../../storage/client';
import { getConfig } from '../../config/env';
import { todayMexicoStr } from '../../core/time';
import { createModuleLogger } from '../../core/logger';
import type { SummaryData, SummarySection } from './types';

const log = createModuleLogger('summary-filter');

const ACTIVE_STATUSES = ['publicada', 'activa', 'en_proceso'];

/**
 * Construye los datos estructurados del resumen diario consultando la DB.
 * Ventana de tiempo: últimas 24 horas.
 */
export async function buildSummaryData(): Promise<SummaryData> {
  const db = getSupabaseClient();
  const config = getConfig();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const today = new Date().toISOString();
  const in5days = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const desertaCutoff = new Date(
    Date.now() - config.ALERT_DESIERTA_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const technicalIncidents: string[] = [];

  // 1. Nuevas activas (created en últimas 24h, status activo)
  const { data: newActiveRows, error: e1 } = await db
    .from('procurements')
    .select('title, external_id, dependency_name, opening_date, source_url, status')
    .gte('created_at', yesterday)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(config.DAILY_SUMMARY_MAX_ITEMS);

  if (e1) {
    log.warn({ err: e1 }, 'Error consultando nuevas activas');
    technicalIncidents.push('Error al consultar nuevas activas');
  }

  const newActive: SummarySection[] = (newActiveRows ?? []).map((r) => ({
    title: r.title,
    externalId: r.external_id,
    dependencyName: r.dependency_name,
    openingDate: r.opening_date,
    matchScore: 0,
    sourceUrl: r.source_url,
    status: r.status,
  }));

  // 2. Desiertas recientes
  const { data: desertaRows, error: e2 } = await db
    .from('procurements')
    .select('title, external_id, dependency_name, opening_date, source_url, status')
    .eq('status', 'desierta')
    .gte('created_at', desertaCutoff)
    .order('created_at', { ascending: false })
    .limit(config.DAILY_SUMMARY_MAX_ITEMS);

  if (e2) {
    log.warn({ err: e2 }, 'Error consultando desiertas recientes');
    technicalIncidents.push('Error al consultar desiertas recientes');
  }

  const recentDesierta: SummarySection[] = (desertaRows ?? []).map((r) => ({
    title: r.title,
    externalId: r.external_id,
    dependencyName: r.dependency_name,
    openingDate: r.opening_date,
    matchScore: 0,
    sourceUrl: r.source_url,
    status: r.status,
  }));

  // 3. Próximas a vencer (opening_date entre hoy y +5 días)
  const { data: expiringRows, error: e3 } = await db
    .from('procurements')
    .select('title, external_id, dependency_name, opening_date, source_url, status')
    .in('status', ACTIVE_STATUSES)
    .gte('opening_date', today)
    .lte('opening_date', in5days)
    .order('opening_date', { ascending: true })
    .limit(config.DAILY_SUMMARY_MAX_ITEMS);

  if (e3) {
    log.warn({ err: e3 }, 'Error consultando próximas a vencer');
    technicalIncidents.push('Error al consultar próximas a vencer');
  }

  const soonExpiring: SummarySection[] = (expiringRows ?? []).map((r) => ({
    title: r.title,
    externalId: r.external_id,
    dependencyName: r.dependency_name,
    openingDate: r.opening_date,
    matchScore: 0,
    sourceUrl: r.source_url,
    status: r.status,
  }));

  // 4. Alto score — matches recientes con score >= 0.7
  const { data: highScoreRows, error: e4 } = await db
    .from('matches')
    .select(`
      match_score,
      procurements!inner(title, external_id, dependency_name, opening_date, source_url, status)
    `)
    .gte('created_at', yesterday)
    .gte('match_score', 0.7)
    .order('match_score', { ascending: false })
    .limit(config.DAILY_SUMMARY_MAX_ITEMS);

  if (e4) {
    log.warn({ err: e4 }, 'Error consultando alto score');
    technicalIncidents.push('Error al consultar matches de alto score');
  }

  const highScore: SummarySection[] = (highScoreRows ?? []).map((r: any) => ({
    title: r.procurements?.title ?? 'Sin título',
    externalId: r.procurements?.external_id ?? '',
    dependencyName: r.procurements?.dependency_name ?? null,
    openingDate: r.procurements?.opening_date ?? null,
    matchScore: r.match_score,
    sourceUrl: r.procurements?.source_url ?? '',
    status: r.procurements?.status ?? '',
  }));

  // Conteos generales
  const { count: totalSeen } = await db
    .from('procurements')
    .select('*', { count: 'exact', head: true })
    .gte('last_seen_at', yesterday);

  const { count: totalNew } = await db
    .from('procurements')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', yesterday);

  const { count: totalAlerts } = await db
    .from('alerts')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', yesterday)
    .eq('telegram_status', 'sent');

  const alertableCount = newActive.length + recentDesierta.length + soonExpiring.length + highScore.length;
  const excludedCount = Math.max(0, (totalSeen ?? 0) - alertableCount);

  return {
    summaryDate: todayMexicoStr(),
    newActive,
    recentDesierta,
    soonExpiring,
    highScore,
    totalSeen: totalSeen ?? 0,
    totalNew: totalNew ?? 0,
    totalAlerts: totalAlerts ?? 0,
    excludedCount,
    technicalIncidents,
  };
}
