/**
 * COLLECT JOB — Orquesta el ciclo de colección de 30 minutos.
 *
 * Flujo:
 * 1. Adquirir lock
 * 2. iniciar collect_run en DB
 * 3. Ejecutar collector (comprasmx primero)
 * 4. Para cada item: upsert en procurements
 * 5. Evaluar contra radares activos
 * 6. Por cada match: enriquecer y enviar alerta
 * 7. Registrar resultado en collect_run
 * 8. Liberar lock
 */
import { createModuleLogger } from '../core/logger';
import { withLock } from '../core/lock';
import { withTimeout } from '../core/errors';
import { nowISO, formatDuration } from '../core/time';
import { healthTracker } from '../core/healthcheck';
import { collectComprasMx, recheckComprasMx, COMPRASMX_SOURCE_KEY, ComprasMxCollectResult } from '../collectors/comprasmx/comprasmx.collector';
import { upsertProcurement } from '../storage/procurement.repo';
import { startCollectRun, finishCollectRun } from '../storage/collect-run.repo';
import { createAlert, markAlertSent, markAlertFailed } from '../storage/match-alert.repo';
import { getActiveRadars } from '../radars/index';
import { evaluateAllRadars } from '../matchers/matcher';
import { enrichMatch } from '../enrichers/match.enricher';
import { sendMatchAlert } from '../alerts/telegram.alerts';
import type { ProcurementStatus } from '../types/procurement';

const log = createModuleLogger('collect-job');

// Source ID para comprasmx — resuelto en bootstrap y propagado aquí
let _comprasMxSourceId: string | null = null;

export function setComprasMxSourceId(id: string | null): void {
  _comprasMxSourceId = id;
}

const COLLECT_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutos

export async function runCollectJob(): Promise<void> {
  log.info('Iniciando ciclo de colección (Playwright Fase 2)');
  const cycleStart = Date.now();

  await withLock('collect-job', 'main-collect', async () => {
    if (!_comprasMxSourceId) {
      log.error('No source_id for comprasmx available. Cannot collect.');
      return;
    }
    const sourceId = _comprasMxSourceId;

    const runId = await startCollectRun(sourceId, COMPRASMX_SOURCE_KEY);
    let itemsSeen = 0;
    let itemsCreated = 0;
    let itemsUpdated = 0;
    let totalMatches = 0;
    let errorMessage: string | null = null;
    let collectResult: ComprasMxCollectResult | null = null;

    try {
      // 1. Colectar
      collectResult = await withTimeout(
        collectComprasMx({ maxPages: 10, headless: true }),
        COLLECT_TIMEOUT_MS,
        'comprasmx-collection'
      );

      itemsSeen = collectResult.items.length;
      log.info({ itemsSeen }, 'Items colectados');

      const radars = getActiveRadars();

      // 2. Procesar cada item
      for (const item of collectResult.items) {
        try {
          // Upsert en DB
          const upsertResult = await upsertProcurement(item, sourceId);

          if (upsertResult.isNew) itemsCreated++;
          else if (upsertResult.isUpdated) itemsUpdated++;

          // Solo evaluar matches si es nuevo o cambió
          if (!upsertResult.isNew && !upsertResult.isUpdated) continue;

          // Determinar estatus anterior para detectar cambio
          const previousStatus = upsertResult.isUpdated && upsertResult.changedFields['status']
            ? (upsertResult.changedFields['status'].prev as ProcurementStatus)
            : null;

          // 3. Match contra radares
          const matches = evaluateAllRadars(
            item,
            radars,
            upsertResult.isNew,
            previousStatus
          );

          totalMatches += matches.length;

          // 4. Enriquecer y alertar por cada match
          for (const match of matches) {
            try {
              // Usar procurement_id real de DB si está disponible
              const enrichableMatch = {
                ...match,
                procurementId: upsertResult.procurementId,
              };

              const enriched = await enrichMatch(item, enrichableMatch);
              const alertId = await createAlert(enriched);

              const msgId = await sendMatchAlert(enriched);

              if (msgId) {
                await markAlertSent(alertId, msgId);
              } else {
                await markAlertFailed(alertId);
              }
            } catch (matchErr) {
              log.error(
                { err: matchErr, radarKey: match.radarKey, externalId: item.externalId },
                'Error procesando match'
              );
            }
          }
        } catch (itemErr) {
          log.error({ err: itemErr, externalId: item.externalId }, 'Error procesando item');
        }
      }

      // Errores del collector
      if (collectResult.errors.length > 0) {
        errorMessage = collectResult.errors.join('; ');
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'Error en ciclo de colección');
    } finally {
      const finishedAt = nowISO();

      await finishCollectRun(runId, {
        finishedAt,
        status: errorMessage ? 'error' : 'success',
        itemsSeen,
        itemsCreated,
        itemsUpdated,
        errorMessage: errorMessage || collectResult?.stopReason || null,
        metadata: { totalMatches, pagesCollected: collectResult?.pagesCollected || 0 },
      });

      await (async () => {
         const { setState, STATE_KEYS } = await import('../core/system-state');
         await setState(STATE_KEYS.LAST_COLLECT_RUN, {
            collectorKey: 'comprasmx_playwright',
            startedAt: cycleStart,
            finishedAt,
            status: errorMessage ? 'error' : 'success',
            errorMessage: errorMessage || collectResult?.stopReason || null,
            itemsSeen,
            itemsCreated,
            itemsUpdated,
            pagesScanned: collectResult?.pagesCollected || 0
         });
      })();

      const durationMs = Date.now() - cycleStart;
      healthTracker.recordCycle(durationMs, totalMatches);

      log.info(
        {
          durationMs: formatDuration(durationMs),
          itemsSeen,
          itemsCreated,
          itemsUpdated,
          totalMatches,
          error: errorMessage,
        },
        'Ciclo completado'
      );
    }
  });
}

/**
 * RE-CHECK JOB (MODO 2) — Para la iteración de Activos diariamente
 */
export async function runRecheckJob(): Promise<void> {
  log.info('🔄 Iniciando ciclo de ReCheck de expedientes activos');
  const cycleStart = Date.now();

  await withLock('recheck-job', 'daily-recheck', async () => {
    if (!_comprasMxSourceId) {
      log.error('No source_id for comprasmx available. Cannot recheck.');
      return;
    }
    const sourceId = _comprasMxSourceId;
    const runId = await startCollectRun(sourceId, COMPRASMX_SOURCE_KEY + '_recheck');

    let itemsSeen = 0;
    let itemsCreated = 0;
    let itemsUpdated = 0;
    let totalMatches = 0;
    let errorMessage: string | null = null;
    
    try {
      const db = (await import('../storage/client')).getSupabaseClient();

      // Obtener expedientes activos o en proceso
      const { data: actives } = await db
        .from('procurements')
        .select('source_url')
        .eq('source_id', sourceId)
        .in('status', ['Vigente', 'activa', 'en_proceso', 'Publicado', 'Por Adjudicar']);

      if (!actives || actives.length === 0) {
        log.info('No hay expedientes activos para re-checar');
        return;
      }

      const urls = actives.map(a => a.source_url).filter(Boolean);
      log.info(`Procediendo a re-checar ${urls.length} URLs activas`);

      const collectResult = await recheckComprasMx(urls);
      itemsSeen = collectResult.itemsSeen;
      
      const radars = getActiveRadars();

      for (const item of collectResult.items) {
        try {
          const upsertResult = await upsertProcurement(item, sourceId);
          if (upsertResult.isNew) itemsCreated++;
          else if (upsertResult.isUpdated) itemsUpdated++;

          if (!upsertResult.isNew && !upsertResult.isUpdated) continue;

          const previousStatus = upsertResult.isUpdated && upsertResult.changedFields['status']
            ? (upsertResult.changedFields['status'].prev as ProcurementStatus)
            : null;

          const matches = evaluateAllRadars(item, radars, upsertResult.isNew, previousStatus);
          totalMatches += matches.length;

          for (const match of matches) {
            try {
              const enrichableMatch = {
                ...match,
                procurementId: upsertResult.procurementId,
              };
              const enriched = await enrichMatch(item, enrichableMatch);
              const alertId = await createAlert(enriched);
              const msgId = await sendMatchAlert(enriched);
              if (msgId) await markAlertSent(alertId, msgId);
              else await markAlertFailed(alertId);
            } catch (err) {
              log.error({ err }, 'Error procesando match en Recheck');
            }
          }
        } catch(e) {
          log.error({ e, url: item.sourceUrl }, 'Error upserting rechecked item');
        }
      }

      if (collectResult.errors.length > 0) {
        errorMessage = collectResult.errors.join('; ');
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err }, '❌ Error en ciclo recheck');
    } finally {
      const finishedAt = nowISO();
      await finishCollectRun(runId, {
        finishedAt,
        status: errorMessage ? 'error' : 'success',
        itemsSeen,
        itemsCreated,
        itemsUpdated,
        errorMessage,
        metadata: { totalMatches },
      });

      const durationMs = Date.now() - cycleStart;
      log.info({ duration: formatDuration(durationMs), status: errorMessage ? 'error' : 'success' }, '🏁 ReCheck Cycle finished');
    }
  });
}

