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
import { collectComprasMx, COMPRASMX_SOURCE_KEY } from '../collectors/comprasmx/comprasmx.collector';
import { upsertProcurement } from '../storage/procurement.repo';
import { startCollectRun, finishCollectRun } from '../storage/collect-run.repo';
import { createAlert, markAlertSent, markAlertFailed } from '../storage/match-alert.repo';
import { getActiveRadars } from '../radars/index';
import { evaluateAllRadars } from '../matchers/matcher';
import { enrichMatch } from '../enrichers/match.enricher';
import { sendMatchAlert } from '../alerts/telegram.alerts';
import type { ProcurementStatus } from '../types/procurement';

const log = createModuleLogger('collect-job');

// Source ID para comprasmx — debe existir en Supabase (seede en Fase 1)
const COMPRASMX_SOURCE_ID = 'comprasmx-source-id'; // TODO: obtener de DB en Fase 1

const COLLECT_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutos

export async function runCollectJob(): Promise<void> {
  log.info('Iniciando ciclo de colección');
  const cycleStart = Date.now();

  await withLock('collect-job', 'main-collect', async () => {
    const runId = await startCollectRun(COMPRASMX_SOURCE_ID, COMPRASMX_SOURCE_KEY);
    let itemsSeen = 0;
    let itemsCreated = 0;
    let itemsUpdated = 0;
    let totalMatches = 0;
    let errorMessage: string | null = null;

    try {
      // 1. Colectar
      const collectResult = await withTimeout(
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
          const upsertResult = await upsertProcurement(item, COMPRASMX_SOURCE_ID);

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
        errorMessage,
        metadata: { totalMatches },
      });

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

// NOTE: COMPRASMX_SOURCE_ID debe resolverse desde la tabla sources en Fase 1.
// Seed en supabase-schema.sql garantiza que el key 'comprasmx' existe.
// En Fase 1: SELECT id FROM sources WHERE key = 'comprasmx'
