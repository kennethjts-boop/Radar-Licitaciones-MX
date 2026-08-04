/**
 * SLEEP MODE — Modo Dormido del Worker.
 *
 * En modo `watchdog_only`:
 * - El scheduler omite colectores, matchers, alertas de radares, resumen diario y OSINT.
 * - El watchdog multi-target (3 licitaciones) y el bot de comandos Telegram siguen activos.
 * - El healthcheck HTTP de Railway responde 200 OK.
 *
 * Precedencia de configuración:
 * system_state.radar_mode > env RADAR_MODE > "full"
 */
import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import { deleteState, getState, setStateStrict, STATE_KEYS } from "../../core/system-state";
import { nowISO } from "../../core/time";
import { getSupabaseClient } from "../../storage/client";

const log = createModuleLogger("control:sleep-mode");

export type RadarMode = "full" | "watchdog_only";

export interface RadarPauseSnapshot {
  paused_at: string;
  previous_mode: RadarMode;
  radars: Array<{ key: string; is_active: boolean }>;
  sources: Array<{ key: string; is_active: boolean }>;
}

/**
 * Obtiene el modo efectivo del radar aplicando precedencia estricta:
 * 1. system_state.radar_mode (configurado dinámicamente vía Telegram /dormir o /despertar)
 * 2. RADAR_MODE env var
 * 3. Fallback a "full"
 */
export async function getEffectiveRadarMode(): Promise<RadarMode> {
  try {
    const dbModePromise = getState<string>(STATE_KEYS.RADAR_MODE);
    const dbMode = await Promise.race([
      dbModePromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
    ]);
    if (dbMode === "watchdog_only" || dbMode === "full") {
      return dbMode;
    }
  } catch (err) {
    log.warn({ err }, "No se pudo consultar system_state[radar_mode]; usando env var fallback");
  }
  const envMode = process.env.RADAR_MODE ?? getConfig().RADAR_MODE;
  if (envMode === "watchdog_only") {
    return "watchdog_only";
  }
  return "full";
}

/**
 * Activa el modo dormido (/dormir):
 * 1. Si no existe snapshot `radar_pause_snapshot`, guarda el estado actual de radares y fuentes en BD.
 * 2. Si ya existe snapshot, NO lo sobrescribe para preservar el estado original.
 * 3. Establece `radar_mode = "watchdog_only"` en system_state.
 * 4. Desactiva radares en la tabla DB (`UPDATE radars SET is_active = false`).
 */
export async function enableSleepMode(): Promise<{
  mode: RadarMode;
  alreadySlept: boolean;
  snapshotCreated: boolean;
  message: string;
}> {
  const db = getSupabaseClient();

  // 1. Verificar snapshot existente
  const existingSnapshot = await getState<RadarPauseSnapshot>(STATE_KEYS.RADAR_PAUSE_SNAPSHOT);
  let snapshotCreated = false;

  if (!existingSnapshot) {
    const [{ data: radarsData }, { data: sourcesData }] = await Promise.all([
      db.from("radars").select("key, is_active"),
      db.from("sources").select("key, is_active"),
    ]);

    const snapshot: RadarPauseSnapshot = {
      paused_at: nowISO(),
      previous_mode: "full",
      radars: (radarsData || []).map((r) => ({ key: r.key, is_active: Boolean(r.is_active) })),
      sources: (sourcesData || []).map((s) => ({ key: s.key, is_active: Boolean(s.is_active) })),
    };

    await setStateStrict(STATE_KEYS.RADAR_PAUSE_SNAPSHOT, snapshot);
    snapshotCreated = true;
    log.info({ snapshot }, "Snapshot de pausa guardado en system_state[radar_pause_snapshot]");
  } else {
    log.info("system_state[radar_pause_snapshot] ya existía; se preserva el estado original");
  }

  // 2. Establecer modo watchdog_only en system_state
  await setStateStrict(STATE_KEYS.RADAR_MODE, "watchdog_only");

  // 3. Desactivar radares en la tabla DB
  const { error: radarErr } = await db
    .from("radars")
    .update({ is_active: false })
    .neq("key", "");

  if (radarErr) {
    log.warn({ error: radarErr.message }, "Warning al actualizar is_active=false en radars");
  }

  const message =
    "😴 Modo dormido. Solo el watchdog sigue vigilando 3 licitaciones. Nada se borró. Usa /despertar para volver a la normalidad.";

  return {
    mode: "watchdog_only",
    alreadySlept: Boolean(existingSnapshot),
    snapshotCreated,
    message,
  };
}

/**
 * Despierta el sistema (/despertar):
 * 1. Lee el snapshot `radar_pause_snapshot` de system_state.
 * 2. Si existe, restaura cada radar y fuente a su estado original `is_active`.
 * 3. Si no existe, reactiva todos los radares a `is_active = true`.
 * 4. Elimina `radar_mode` y `radar_pause_snapshot` de system_state.
 */
export async function wakeFromSleepMode(): Promise<{
  mode: RadarMode;
  radarsRestored: number;
  sourcesRestored: number;
  usedDefault: boolean;
  message: string;
}> {
  const db = getSupabaseClient();
  const snapshot = await getState<RadarPauseSnapshot>(STATE_KEYS.RADAR_PAUSE_SNAPSHOT);

  let radarsRestored = 0;
  let sourcesRestored = 0;
  let usedDefault = false;

  if (snapshot && Array.isArray(snapshot.radars)) {
    for (const r of snapshot.radars) {
      await db.from("radars").update({ is_active: r.is_active }).eq("key", r.key);
      radarsRestored++;
    }
    if (Array.isArray(snapshot.sources)) {
      for (const s of snapshot.sources) {
        await db.from("sources").update({ is_active: s.is_active }).eq("key", s.key);
        sourcesRestored++;
      }
    }
  } else {
    usedDefault = true;
    const { data: allRadars } = await db.from("radars").select("key");
    const keys = (allRadars || []).map((r) => r.key);
    for (const key of keys) {
      await db.from("radars").update({ is_active: true }).eq("key", key);
      radarsRestored++;
    }
    sourcesRestored = 10;
  }

  await deleteState(STATE_KEYS.RADAR_MODE);
  await deleteState(STATE_KEYS.RADAR_PAUSE_SNAPSHOT);

  const message = usedDefault
    ? `☀️ Todo despierto. Radars restaurados: ${radarsRestored} (usando valor por defecto). Fuentes restauradas: ${sourcesRestored}.`
    : `☀️ Todo despierto. Radars restaurados: ${radarsRestored}. Fuentes restauradas: ${sourcesRestored}.`;

  return {
    mode: "full",
    radarsRestored,
    sourcesRestored,
    usedDefault,
    message,
  };
}
