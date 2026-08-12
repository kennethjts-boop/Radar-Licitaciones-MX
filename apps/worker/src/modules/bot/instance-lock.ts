import { randomUUID } from "node:crypto";
import { createModuleLogger } from "../../core/logger";
import { getSupabaseClient } from "../../storage/client";
import { withTimeout } from "../../core/errors";

const log = createModuleLogger("telegram-instance-lock");

const POLLING_LOCK_KEY = "telegram_polling";
const POLLING_LOCK_TTL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const MAX_UNRENEWED_AGE_MS = 20_000;
const SUPABASE_TIMEOUT_MS = 5_000;

type LockLostHandler = () => void | Promise<void>;

type PollingInstanceEnvironment = Partial<
  Pick<
    NodeJS.ProcessEnv,
    "RAILWAY_DEPLOYMENT_ID" | "RAILWAY_REPLICA_ID" | "HOSTNAME"
  >
>;

/**
 * La identidad del dueño debe ser única por proceso, no solo por réplica.
 * Railway puede solapar dos procesos durante un deploy y ambos pueden exponer
 * el mismo RAILWAY_REPLICA_ID; si compartieran el id, la RPC permitiría que los
 * dos renovaran el mismo lock y Telegram respondería 409 a getUpdates.
 */
export function buildPollingInstanceId(
  env: PollingInstanceEnvironment = process.env,
  pid = process.pid,
  nonce: string = randomUUID(),
): string {
  const deployment = env.RAILWAY_DEPLOYMENT_ID ?? "local-deployment";
  const replica = env.RAILWAY_REPLICA_ID ?? env.HOSTNAME ?? "local-instance";
  return `${deployment}:${replica}:${pid}:${nonce}`;
}

const instanceId = buildPollingInstanceId();

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatInFlight = false;
let lockLostHandler: LockLostHandler | undefined;
let lastSuccessfulRenewalAt = 0;
let lockLostTriggered = false;

export function getLastSuccessfulRenewalAt(): number {
  return lastSuccessfulRenewalAt;
}

export function isPollingLockValid(): boolean {
  return (
    lastSuccessfulRenewalAt > 0 &&
    Date.now() - lastSuccessfulRenewalAt < MAX_UNRENEWED_AGE_MS
  );
}

export async function acquirePollingLock(): Promise<boolean> {
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        getSupabaseClient().rpc("claim_polling_lock", {
          p_key: POLLING_LOCK_KEY,
          p_instance: instanceId,
          p_ttl_ms: POLLING_LOCK_TTL_MS,
        }),
      ),
      SUPABASE_TIMEOUT_MS,
      "claim_polling_lock",
    );

    if (error) {
      log.warn(
        { err: error, instanceId },
        "No se pudo reclamar el lock de polling",
      );
      return false;
    }

    if (data === true) {
      lastSuccessfulRenewalAt = Date.now();
      lockLostTriggered = false;
      return true;
    }

    return false;
  } catch (err) {
    log.warn(
      { err, instanceId },
      "Error inesperado reclamando el lock de polling",
    );
    return false;
  }
}

async function triggerLockLost(): Promise<void> {
  if (lockLostTriggered) return;
  lockLostTriggered = true;

  const onLockLost = lockLostHandler;
  stopHeartbeat();

  if (onLockLost) {
    try {
      await onLockLost();
    } catch (err) {
      log.warn({ err }, "Error ejecutando handler de lock perdido");
    }
  }
}

async function renewHeartbeat(): Promise<void> {
  if (heartbeatInFlight || lockLostTriggered) return;
  heartbeatInFlight = true;

  try {
    const now = Date.now();
    if (
      lastSuccessfulRenewalAt > 0 &&
      now - lastSuccessfulRenewalAt >= MAX_UNRENEWED_AGE_MS
    ) {
      log.warn(
        {
          instanceId,
          elapsedMs: now - lastSuccessfulRenewalAt,
          maxAgeMs: MAX_UNRENEWED_AGE_MS,
        },
        "Límite seguro de TTL de lock superado sin renovación confirmada — declarando lock perdido",
      );
      await triggerLockLost();
      return;
    }

    const { data, error } = await withTimeout(
      Promise.resolve(
        getSupabaseClient()
          .from("bot_lock")
          .update({ updated_at: new Date().toISOString() })
          .eq("key", POLLING_LOCK_KEY)
          .eq("instance_id", instanceId)
          .select("key"),
      ),
      SUPABASE_TIMEOUT_MS,
      "bot_lock heartbeat update",
    );

    if (error) {
      log.warn(
        { err: error, instanceId },
        "No se pudo renovar el heartbeat del lock de polling",
      );
      if (
        lastSuccessfulRenewalAt > 0 &&
        Date.now() - lastSuccessfulRenewalAt >= MAX_UNRENEWED_AGE_MS
      ) {
        log.warn(
          { instanceId, elapsedMs: Date.now() - lastSuccessfulRenewalAt },
          "Lock expirado tras fallo de Supabase — declarando lock perdido",
        );
        await triggerLockLost();
      }
      return;
    }

    if (!data || data.length === 0) {
      log.warn(
        { instanceId },
        "La instancia perdió el lock de polling (0 filas actualizadas)",
      );
      await triggerLockLost();
      return;
    }

    lastSuccessfulRenewalAt = Date.now();
  } catch (err) {
    log.warn(
      { err, instanceId },
      "Error inesperado renovando el heartbeat del lock de polling",
    );
    if (
      lastSuccessfulRenewalAt > 0 &&
      Date.now() - lastSuccessfulRenewalAt >= MAX_UNRENEWED_AGE_MS
    ) {
      log.warn(
        { instanceId, elapsedMs: Date.now() - lastSuccessfulRenewalAt },
        "Lock expirado tras excepción en heartbeat — declarando lock perdido",
      );
      await triggerLockLost();
    }
  } finally {
    heartbeatInFlight = false;
  }
}

export function startHeartbeat(
  onLockLost?: LockLostHandler,
): () => void {
  lockLostHandler = onLockLost;
  lockLostTriggered = false;
  if (lastSuccessfulRenewalAt === 0) {
    lastSuccessfulRenewalAt = Date.now();
  }
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
  lastSuccessfulRenewalAt = 0;
}

export function resetPollingLockForTests(): void {
  stopHeartbeat();
  heartbeatInFlight = false;
  lockLostTriggered = false;
  lastSuccessfulRenewalAt = 0;
}

