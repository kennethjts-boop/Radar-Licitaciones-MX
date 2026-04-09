/**
 * HEARTBEAT JOB — Ciclo base de Fase 1.
 *
 * En Fase 1 no hay scraping real. Este job:
 * - Corre cada 30 minutos (igual que el futuro collect job)
 * - Registra un collect_run de tipo 'heartbeat' en DB
 * - Actualiza el healthcheck en memoria
 * - Verifica conectividad con Supabase en cada ciclo
 * - Actualiza system_state con última corrida
 * - NO toca collectors ni Playwright
 *
 * En Fase 2 este job será reemplazado por collect.job.ts real.
 * El punto de inserción está marcado con: // FASE 2: reemplazar aquí
 */
import { createModuleLogger } from "../core/logger";
import { withLock } from "../core/lock";
import { healthTracker } from "../core/healthcheck";
import { recordHealthcheck, setState, STATE_KEYS } from "../core/system-state";
import { nowISO, formatDuration } from "../core/time";
import { getActiveRadars } from "../radars/index";
import { getSupabaseClient } from "../storage/client";

const log = createModuleLogger("heartbeat-job");

// Source ID de comprasmx — resuelto en bootstrap y pasado acá
let _comprasMxSourceId: string | null = null;

export function setComprasMxSourceId(id: string | null): void {
  _comprasMxSourceId = id;
}

export async function runHeartbeatJob(): Promise<void> {
  log.info("🔄 Cycle started (heartbeat)");
  const cycleStart = Date.now();

  await withLock("heartbeat-job", "main-heartbeat", async () => {
    const startedAt = nowISO();
    let errorMessage: string | null = null;
    let dbReachable = false;

    try {
      // ── Verificar DB en este ciclo ─────────────────────────────────────────
      const db = getSupabaseClient();
      const { data, error } = await db
        .from("sources")
        .select("id")
        .eq("key", "comprasmx")
        .single();

      if (error && error.code !== "PGRST116") {
        log.warn(
          { error: error.message },
          "⚠️ DB no accesible en ciclo heartbeat",
        );
        errorMessage = `DB error: ${error.message}`;
        healthTracker.setDbHealth("down");
      } else {
        dbReachable = true;
        healthTracker.setDbHealth("ok");

        // Actualizar source_id si lo encontramos
        if (data?.id && !_comprasMxSourceId) {
          _comprasMxSourceId = data.id;
          log.info(
            { sourceId: data.id },
            "Source ID comprasmx resuelto en ciclo",
          );
        }
      }

      // ── FASE 2: reemplazar aquí con collector real ─────────────────────────
      // En Fase 2, el heartbeat job se reemplaza por collect.job.ts que:
      //   1. Llama a collectComprasMx()
      //   2. Normaliza cada item
      //   3. Hace upsert en procurements
      //   4. Evalúa matchers
      //   5. Envía alertas
      // ──────────────────────────────────────────────────────────────────────

      log.info(
        {
          dbReachable,
          radarsActive: getActiveRadars().length,
          sourceId: _comprasMxSourceId ?? "pendiente",
        },
        "✅ Ciclo heartbeat completado (sin scraping — Fase 1)",
      );
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err }, "❌ Error en ciclo heartbeat");
    } finally {
      const finishedAt = nowISO();
      const durationMs = Date.now() - cycleStart;

      // Actualizar healthcheck en memoria
      healthTracker.recordCycle(durationMs, 0);

      // Registrar en system_state y collect_runs real
      if (dbReachable) {
        const hs = healthTracker.getStatus();
        await recordHealthcheck({
          healthy: hs.overall === "ok",
          worker_status: hs.overall,
          db_connected: hs.dbConnected,
          db_schema_valid: hs.dbSchemaValid,
          telegram_connected: hs.services.telegram === "ok",
          runtime_db_mode: "supabase-rest",
        });
        const db = getSupabaseClient();

        // Registrar system_state
        await setState(STATE_KEYS.LAST_COLLECT_RUN, {
          collectorKey: "heartbeat",
          startedAt,
          finishedAt,
          status: errorMessage ? "error" : "success",
          errorMessage,
          itemsSeen: 0,
          itemsCreated: 0,
        });

        // Registrar en collect_runs (Log del ciclo)
        if (_comprasMxSourceId) {
          await db.from("collect_runs").insert({
            source_id: _comprasMxSourceId,
            collector_key: "heartbeat_phase_1",
            started_at: startedAt,
            finished_at: finishedAt,
            status: errorMessage ? "error" : "success",
            items_seen: 0,
            items_created: 0,
            items_updated: 0,
            error_message: errorMessage,
          });
        }
      }

      log.info(
        {
          duration: formatDuration(durationMs),
          status: errorMessage ? "error" : "success",
        },
        "🏁 Cycle finished",
      );
    }
  });
}
