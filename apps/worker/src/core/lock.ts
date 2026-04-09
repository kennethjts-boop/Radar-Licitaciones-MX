/**
 * LOCK — Previene solapamiento de corridas del scheduler.
 * Implementación en memoria (suficiente para proceso único en Railway).
 * Para multi-instancia usar Supabase system_state.
 */
import { createModuleLogger } from "./logger";
import { nowISO } from "./time";

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
