import { createModuleLogger } from "../../core/logger";
import { getSupabaseClient } from "../../storage/client";

const log = createModuleLogger("telegram-instance-lock");

const POLLING_LOCK_KEY = "telegram_polling";
const POLLING_LOCK_TTL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

type LockLostHandler = () => void | Promise<void>;

const instanceId =
  process.env.RAILWAY_REPLICA_ID ??
  `local-${process.pid}-${Date.now()}`;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatInFlight = false;
let lockLostHandler: LockLostHandler | undefined;

export async function acquirePollingLock(): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseClient().rpc(
      "claim_polling_lock",
      {
        p_key: POLLING_LOCK_KEY,
        p_instance: instanceId,
        p_ttl_ms: POLLING_LOCK_TTL_MS,
      },
    );

    if (error) {
      log.warn(
        { err: error, instanceId },
        "No se pudo reclamar el lock de polling",
      );
      return false;
    }

    return data === true;
  } catch (err) {
    log.warn(
      { err, instanceId },
      "Error inesperado reclamando el lock de polling",
    );
    return false;
  }
}

async function renewHeartbeat(): Promise<void> {
  if (heartbeatInFlight) return;
  heartbeatInFlight = true;

  try {
    const { data, error } = await getSupabaseClient()
      .from("bot_lock")
      .update({ updated_at: new Date().toISOString() })
      .eq("key", POLLING_LOCK_KEY)
      .eq("instance_id", instanceId)
      .select("key");

    if (error) {
      log.warn(
        { err: error, instanceId },
        "No se pudo renovar el heartbeat del lock de polling",
      );
      return;
    }

    if (!data || data.length === 0) {
      log.warn(
        { instanceId },
        "La instancia perdió el lock de polling",
      );
      const onLockLost = lockLostHandler;
      stopHeartbeat();
      await onLockLost?.();
    }
  } catch (err) {
    log.warn(
      { err, instanceId },
      "Error inesperado renovando el heartbeat del lock de polling",
    );
  } finally {
    heartbeatInFlight = false;
  }
}

export function startHeartbeat(
  onLockLost?: LockLostHandler,
): () => void {
  lockLostHandler = onLockLost;
  if (heartbeatTimer) return stopHeartbeat;

  heartbeatTimer = setInterval(() => {
    void renewHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  log.info(
    { instanceId, intervalMs: HEARTBEAT_INTERVAL_MS },
    "Heartbeat del lock de polling iniciado",
  );

  return stopHeartbeat;
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  lockLostHandler = undefined;
}
