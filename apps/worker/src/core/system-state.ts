/**
 * SYSTEM STATE — Persistencia de estado del worker en Supabase.
 * Usa la tabla system_state (key-value JSONB) para registrar
 * eventos importantes del ciclo de vida del worker.
 *
 * No lanza excepciones — falla silenciosamente con log.warn.
 * El worker NO debe caerse por un fallo de system_state.
 */
import { createModuleLogger } from './logger';
import { nowISO } from './time';

const log = createModuleLogger('system-state');

// Cargamos el cliente de forma lazy para evitar circular dependencies
async function getDb() {
  const { getSupabaseClient } = await import('../storage/client');
  return getSupabaseClient();
}

// ─── Claves conocidas del sistema ─────────────────────────────────────────────

export const STATE_KEYS = {
  WORKER_BOOT_TIME:      'worker_boot_time',
  LAST_HEALTHCHECK_AT:   'last_healthcheck_at',
  SCHEDULER_STATUS:      'scheduler_status',
  LAST_COLLECT_RUN:      'last_collect_run',
  WORKER_VERSION:        'worker_version',
} as const;

export type StateKey = typeof STATE_KEYS[keyof typeof STATE_KEYS];

// ─── Leer valor ───────────────────────────────────────────────────────────────

export async function getState<T = unknown>(key: StateKey): Promise<T | null> {
  try {
    const db = await getDb();
    const { data, error } = await db
      .from('system_state')
      .select('value_json')
      .eq('key', key)
      .single();

    if (error && error.code !== 'PGRST116') {
      log.warn({ key, error: error.message }, 'Error leyendo system_state');
      return null;
    }

    return (data?.value_json as T) ?? null;
  } catch (err) {
    log.warn({ key, err }, 'Error leyendo system_state');
    return null;
  }
}

// ─── Escribir valor ───────────────────────────────────────────────────────────

export async function setState(
  key: StateKey,
  value: Record<string, unknown>
): Promise<void> {
  try {
    const db = await getDb();
    const { error } = await db
      .from('system_state')
      .upsert(
        { key, value_json: value, updated_at: nowISO() },
        { onConflict: 'key' }
      );

    if (error) {
      log.warn({ key, error: error.message }, 'Error escribiendo system_state');
    }
  } catch (err) {
    log.warn({ key, err }, 'Error escribiendo system_state');
  }
}

// ─── Helpers de alto nivel ────────────────────────────────────────────────────

export async function recordWorkerBoot(version = '0.1.0'): Promise<void> {
  await setState(STATE_KEYS.WORKER_BOOT_TIME, {
    bootedAt: nowISO(),
    version,
    pid: process.pid,
  });

  await setState(STATE_KEYS.SCHEDULER_STATUS, {
    status: 'starting',
    startedAt: nowISO(),
  });
}

export async function recordSchedulerStarted(
  collectCron: string,
  summaryCron: string
): Promise<void> {
  await setState(STATE_KEYS.SCHEDULER_STATUS, {
    status: 'active',
    collectCron,
    summaryCron,
    startedAt: nowISO(),
  });
}

export async function recordHealthcheck(healthy: boolean): Promise<void> {
  await setState(STATE_KEYS.LAST_HEALTHCHECK_AT, {
    checkedAt: nowISO(),
    healthy,
  });
}
