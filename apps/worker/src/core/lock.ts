/**
 * LOCK — Previene solapamiento de corridas del scheduler.
 * Implementación en memoria (suficiente para proceso único en Railway).
 *
 * withDistributedLock() añade una segunda capa respaldada en Supabase
 * (tabla bot_lock, mismo patrón que modules/bot/instance-lock.ts) para los
 * jobs donde dos procesos solapados (deploy de Railway) causarían duplicados
 * reales — p.ej. alertas de Telegram. withLock() (solo memoria) se mantiene
 * intacto para jobs donde un lock por-proceso ya es suficiente (heartbeat).
 */
import { createModuleLogger } from "./logger";
import { nowISO } from "./time";
import { withTimeout } from "./errors";
import { getSupabaseClient } from "../storage/client";
import { buildPollingInstanceId } from "../modules/bot/instance-lock";

const log = createModuleLogger("lock");

interface LockEntry {
  acquiredAt: string;
  jobName: string;
}

class InMemoryLock {
  private locks = new Map<string, LockEntry>();

  acquire(
    lockName: string,
    jobName: string,
    timeoutMs = 25 * 60 * 1000,
  ): boolean {
    const existing = this.locks.get(lockName);

    if (existing) {
      const elapsed = Date.now() - new Date(existing.acquiredAt).getTime();
      if (elapsed < timeoutMs) {
        log.warn(
          { lockName, jobName: existing.jobName, elapsedMs: elapsed },
          "Lock activo — saltando ciclo",
        );
        return false;
      }
      // Lock expirado — forzar liberación
      log.warn(
        { lockName, elapsedMs: elapsed },
        "Lock expirado — forzando liberación",
      );
      this.locks.delete(lockName);
    }

    this.locks.set(lockName, { acquiredAt: nowISO(), jobName });
    log.debug({ lockName, jobName }, "Lock adquirido");
    return true;
  }

  release(lockName: string): void {
    this.locks.delete(lockName);
    log.debug({ lockName }, "Lock liberado");
  }

  isLocked(lockName: string): boolean {
    return this.locks.has(lockName);
  }
}

export const lock = new InMemoryLock();

/**
 * Decorador funcional — ejecuta fn solo si puede adquirir el lock.
 */
export async function withLock<T>(
  lockName: string,
  jobName: string,
  fn: () => Promise<T>,
  timeoutMs?: number,
): Promise<T | null> {
  const acquired = lock.acquire(lockName, jobName, timeoutMs);
  if (!acquired) return null;

  try {
    return await fn();
  } finally {
    lock.release(lockName);
  }
}

// ── Lock distribuido (Supabase bot_lock) ───────────────────────────────────

// TTL corto a propósito: si el proceso muere sin liberar, el lock expira en
// ~2 min (no 25). Se renueva cada ~30s mientras fn corre para que un ciclo
// más largo de lo previsto no pierda el lock a mitad de ejecución.
export const JOB_LOCK_TTL_MS = 2 * 60 * 1000;
const JOB_LOCK_RENEW_INTERVAL_MS = 30 * 1000;
const JOB_LOCK_SUPABASE_TIMEOUT_MS = 5_000;

// Identidad única por proceso (no por réplica — ver instance-lock.ts). Se
// reusa la misma lógica de construcción que ya usa el lock de polling de
// Telegram en vez de reimplementarla.
const jobInstanceId = buildPollingInstanceId();

async function claimJobLock(lockName: string, ttlMs: number): Promise<boolean> {
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        getSupabaseClient().rpc("claim_polling_lock", {
          p_key: lockName,
          p_instance: jobInstanceId,
          p_ttl_ms: ttlMs,
        }),
      ),
      JOB_LOCK_SUPABASE_TIMEOUT_MS,
      `claim_job_lock:${lockName}`,
    );

    if (error) {
      log.warn({ err: error, lockName }, "Error reclamando lock distribuido");
      return false;
    }
    return data === true;
  } catch (err) {
    log.warn({ err, lockName }, "Excepción reclamando lock distribuido");
    return false;
  }
}

/**
 * Limitación aceptada (no bloqueante): si esta renovación falla repetidamente
 * y el TTL termina venciendo, otro proceso puede reclamar el lock distribuido
 * mientras fn sigue corriendo aquí — a diferencia del triggerLockLost() de
 * instance-lock.ts, aquí no se aborta fn ante ese escenario, solo se deja el
 * warn de abajo. Es una degradación aceptable y de todos modos mejor que el
 * estado previo a esta fase (sin lock distribuido en absoluto).
 */
async function renewJobLock(lockName: string, ttlMs: number): Promise<void> {
  const renewed = await claimJobLock(lockName, ttlMs);
  if (!renewed) {
    log.warn(
      { lockName, instanceId: jobInstanceId },
      "No se pudo renovar el lock distribuido — otro proceso podría reclamarlo al vencer el TTL",
    );
  }
}

async function releaseJobLock(lockName: string): Promise<void> {
  try {
    const { error } = await withTimeout(
      Promise.resolve(
        getSupabaseClient().rpc("release_job_lock", {
          p_key: lockName,
          p_instance: jobInstanceId,
        }),
      ),
      JOB_LOCK_SUPABASE_TIMEOUT_MS,
      `release_job_lock:${lockName}`,
    );
    if (error) {
      log.warn(
        { err: error, lockName },
        "No se pudo liberar el lock distribuido explícitamente (expirará por TTL)",
      );
    }
  } catch (err) {
    log.warn(
      { err, lockName },
      "Excepción liberando el lock distribuido (expirará por TTL)",
    );
  }
}

/**
 * Lock distribuido de dos capas para jobs donde un solapamiento entre
 * procesos (deploy de Railway) produciría efectos externos duplicados
 * (alertas de Telegram).
 *
 * 1. Lock en memoria (rápido, sin red): corta de inmediato el caso de que el
 *    MISMO proceso intente correr el job dos veces (p.ej. scheduler solapado).
 * 2. Solo si el paso 1 lo adquiere, reclama el lock distribuido en Supabase
 *    para cubrir el caso de OTRO proceso corriendo simultáneamente.
 *
 * Fail-closed: si Supabase no responde o la RPC falla, NO se ejecuta fn — se
 * registra un warn y se retorna null (mismo criterio que cycleIsPaused() en
 * jobs/scheduler.ts: perder un ciclo se recupera en el siguiente; un ciclo
 * duplicado manda alertas duplicadas).
 */
export async function withDistributedLock<T>(
  lockName: string,
  jobName: string,
  fn: () => Promise<T>,
  ttlMs: number = JOB_LOCK_TTL_MS,
): Promise<T | null> {
  // OJO: no pasar ttlMs aquí. El lock en memoria NO se renueva mientras fn
  // corre (solo el distribuido lo hace vía renewJobLock) — su timeout es el
  // umbral de "huérfano" para forzar liberación, no un TTL renovable. Si se le
  // pasa el TTL corto del distribuido, un collect que tarde más de esos ~2 min
  // (normal con Playwright) hace que la propia capa 1 declare su lock
  // expirado y lo conceda de nuevo al mismo proceso, dejando pasar el caso
  // mismo-proceso que esta capa existe para bloquear (p.ej. un collect manual
  // desde Telegram mientras corre el programado). Se deja en el default largo
  // (25 min) para que actúe solo como red de seguridad ante un proceso muerto.
  const acquiredLocal = lock.acquire(lockName, jobName);
  if (!acquiredLocal) return null;

  let claimedDistributed = false;
  let renewTimer: ReturnType<typeof setInterval> | null = null;

  try {
    claimedDistributed = await claimJobLock(lockName, ttlMs);
    if (!claimedDistributed) {
      log.warn(
        { lockName, jobName, instanceId: jobInstanceId },
        "No se pudo reclamar el lock distribuido — ciclo omitido por seguridad",
      );
      return null;
    }

    renewTimer = setInterval(() => {
      void renewJobLock(lockName, ttlMs);
    }, JOB_LOCK_RENEW_INTERVAL_MS);
    renewTimer.unref();

    return await fn();
  } finally {
    if (renewTimer) clearInterval(renewTimer);
    if (claimedDistributed) {
      await releaseJobLock(lockName);
    }
    lock.release(lockName);
  }
}
