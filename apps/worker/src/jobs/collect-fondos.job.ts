/**
 * COLLECT FONDOS JOB — Colecta convocatorias de donaciones/fondos internacionales.
 *
 * Ejecuta los 6 collectors de fondos (axios + cheerio, sin Playwright):
 *   1. INAH — procuraciondefondos.inah.gob.mx
 *   2. ConCausa — difusionconcausa.com
 *   3. GestionandoTe — gestionandote.org
 *   4. CECANI — cecani.org
 *   5. COPREV — coprev.com.mx
 *   6. Monte de Piedad — inversionsocial.montepiedad.com.mx
 *
 * Flujo por collector:
 *   1. Resolver source_id desde DB (por key)
 *   2. startCollectRun
 *   3. Ejecutar collector
 *   4. Para cada item: upsertProcurement → evaluateAllRadars → alertas
 *   5. finishCollectRun
 *
 * Cron: cada 6 horas (las fuentes no cambian frecuentemente).
 * No toca el flujo de ComprasMX.
 */
import { createModuleLogger } from "../core/logger";
import { nowISO, formatDuration } from "../core/time";
import { getActiveRadars } from "../radars/index";
import { evaluateAllRadars } from "../matchers/matcher";
import { enrichMatch } from "../enrichers/match.enricher";
import { upsertProcurement } from "../storage/procurement.repo";
import { startCollectRun, finishCollectRun } from "../storage/collect-run.repo";
import {
  createAlert,
  markAlertSent,
  markAlertFailed,
} from "../storage/match-alert.repo";
import { sendMatchAlert } from "../alerts/telegram.alerts";
import { getSupabaseClient } from "../storage/client";
import type { NormalizedProcurement, ProcurementStatus } from "../types/procurement";

// Collectors de fondos
import { collectInah, INAH_SOURCE_KEY } from "../collectors/fondos/inah.collector";
import {
  collectConcausa,
  CONCAUSA_SOURCE_KEY,
} from "../collectors/fondos/concausa.collector";
import {
  collectGestionandote,
  GESTIONANDOTE_SOURCE_KEY,
} from "../collectors/fondos/gestionandote.collector";
import { collectCecani, CECANI_SOURCE_KEY } from "../collectors/fondos/cecani.collector";
import { collectCoprev, COPREV_SOURCE_KEY } from "../collectors/fondos/coprev.collector";
import {
  collectMontepiedad,
  MONTEPIEDAD_SOURCE_KEY,
} from "../collectors/fondos/montepiedad.collector";

const log = createModuleLogger("collect-fondos-job");
const MAX_ALERTS_PER_CYCLE = 50; // límite conservador para fuentes de fondos

// ── Resolución de source IDs ──────────────────────────────────────────────────

async function resolveSourceId(key: string): Promise<string | null> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("sources")
    .select("id")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    log.warn({ err: error, key }, "No se pudo resolver source_id para fondos key");
    return null;
  }
  return data?.id ?? null;
}

// ── Procesador de items (reutilizable) ────────────────────────────────────────

async function processItems(
  items: NormalizedProcurement[],
  sourceId: string,
): Promise<{ created: number; updated: number; matches: number; alerts: number }> {
  const radars = getActiveRadars();
  let created = 0;
  let updated = 0;
  let matches = 0;
  let alertsSent = 0;

  for (const item of items) {
    try {
      const upsertResult = await upsertProcurement(item, sourceId);

      if (upsertResult.isNew) created++;
      else if (upsertResult.isUpdated) updated++;

      // Solo evaluar matches si es nuevo o cambió
      if (!upsertResult.isNew && !upsertResult.isUpdated) continue;

      const previousStatus =
        upsertResult.isUpdated && upsertResult.changedFields["status"]
          ? (upsertResult.changedFields["status"].prev as ProcurementStatus)
          : null;

      const itemMatches = evaluateAllRadars(
        item,
        radars,
        upsertResult.isNew,
        previousStatus,
      );
      matches += itemMatches.length;

      for (const match of itemMatches) {
        try {
          if (alertsSent >= MAX_ALERTS_PER_CYCLE) break;

          const enrichableMatch = {
            ...match,
            procurementId: upsertResult.procurementId,
          };

          const enriched = await enrichMatch(item, enrichableMatch);
          const alertId = await createAlert(enriched);
          const msgId = await sendMatchAlert(enriched);

          if (msgId) {
            alertsSent++;
            await markAlertSent(alertId, msgId);
          } else {
            await markAlertFailed(alertId);
          }
        } catch (alertErr) {
          log.error(
            { err: alertErr, radarKey: match.radarKey, externalId: item.externalId },
            "Error procesando alerta de fondos",
          );
        }
      }
    } catch (itemErr) {
      log.error({ err: itemErr, externalId: item.externalId }, "Error procesando item de fondos");
    }
  }

  return { created, updated, matches, alerts: alertsSent };
}

// ── Job principal ─────────────────────────────────────────────────────────────

interface CollectorEntry {
  key: string;
  label: string;
  collect: () => Promise<{ items: NormalizedProcurement[]; errors: string[]; startedAt: string; finishedAt: string }>;
}

const COLLECTORS: CollectorEntry[] = [
  { key: INAH_SOURCE_KEY, label: "INAH", collect: collectInah },
  { key: CONCAUSA_SOURCE_KEY, label: "ConCausa", collect: collectConcausa },
  { key: GESTIONANDOTE_SOURCE_KEY, label: "GestionandoTe", collect: collectGestionandote },
  { key: CECANI_SOURCE_KEY, label: "CECANI", collect: collectCecani },
  { key: COPREV_SOURCE_KEY, label: "COPREV", collect: collectCoprev },
  { key: MONTEPIEDAD_SOURCE_KEY, label: "Monte de Piedad", collect: collectMontepiedad },
];

export async function runCollectFondosJob(): Promise<void> {
  const jobStart = Date.now();
  log.info("Iniciando ciclo de colección de fondos internacionales");

  let totalItems = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalMatches = 0;
  let totalAlerts = 0;
  const collectorErrors: string[] = [];

  for (const entry of COLLECTORS) {
    const collectorStart = Date.now();
    log.info({ collector: entry.label }, "Ejecutando collector de fondos");

    // Resolver source_id para este collector
    const sourceId = await resolveSourceId(entry.key);
    if (!sourceId) {
      const msg = `source_id no encontrado para key="${entry.key}" — ¿ejecutaste la migración 10_fondos_sources.sql?`;
      log.warn({ key: entry.key }, msg);
      collectorErrors.push(msg);
      continue;
    }

    let runId: string | null = null;
    let itemsSeen = 0;
    let itemsCreated = 0;
    let itemsUpdated = 0;
    let runErrors: string[] = [];

    try {
      runId = await startCollectRun(sourceId, entry.key);

      const result = await entry.collect();
      runErrors = result.errors;
      itemsSeen = result.items.length;

      const stats = await processItems(result.items, sourceId);
      itemsCreated = stats.created;
      itemsUpdated = stats.updated;

      totalItems += itemsSeen;
      totalCreated += itemsCreated;
      totalUpdated += itemsUpdated;
      totalMatches += stats.matches;
      totalAlerts += stats.alerts;

      log.info(
        {
          collector: entry.label,
          itemsSeen,
          itemsCreated,
          itemsUpdated,
          matches: stats.matches,
          alerts: stats.alerts,
          durationMs: Date.now() - collectorStart,
        },
        "Collector de fondos completado",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err, collector: entry.label }, "Error en collector de fondos");
      runErrors.push(msg);
      collectorErrors.push(`${entry.label}: ${msg}`);
    } finally {
      if (runId) {
        await finishCollectRun(runId, {
          finishedAt: nowISO(),
          status: runErrors.length > 0 ? "error" : "success",
          itemsSeen,
          itemsCreated,
          itemsUpdated,
          errorMessage: runErrors.length > 0 ? runErrors.join("; ") : null,
          metadata: { collector: entry.label, sourceKey: entry.key },
        }).catch((finishErr) => {
          log.warn(
            { err: finishErr, collector: entry.label },
            "No se pudo finalizar collect_run de fondos",
          );
        });
      }
    }
  }

  log.info(
    {
      totalItems,
      totalCreated,
      totalUpdated,
      totalMatches,
      totalAlerts,
      errors: collectorErrors.length,
      durationMs: formatDuration(Date.now() - jobStart),
    },
    "Ciclo de fondos internacionales completado",
  );
}
