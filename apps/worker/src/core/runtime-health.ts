export type BootstrapRuntimeStatus = "pending" | "ok" | "failed";
export type TelegramPollingRuntimeStatus =
  | "disabled"
  | "starting"
  | "ok"
  | "degraded";
export type DatabaseRuntimeStatus = "unknown" | "ok" | "error";

export interface RuntimeHealthSnapshot {
  status: "ok";
  ts: string;
  uptimeSeconds: number;
  bootstrap: BootstrapRuntimeStatus;
  telegramPolling: TelegramPollingRuntimeStatus;
  db: DatabaseRuntimeStatus;
}

const processStartedAtMs = Date.now();
let bootstrapStatus: BootstrapRuntimeStatus = "pending";
let telegramPollingStatus: TelegramPollingRuntimeStatus = "disabled";
let databaseStatus: DatabaseRuntimeStatus = "unknown";

export function setBootstrapRuntimeStatus(
  status: BootstrapRuntimeStatus,
): void {
  bootstrapStatus = status;
}

export function setTelegramPollingRuntimeStatus(
  status: TelegramPollingRuntimeStatus,
): void {
  telegramPollingStatus = status;
}

export function setDatabaseRuntimeStatus(
  status: DatabaseRuntimeStatus,
): void {
  databaseStatus = status;
}

export function getRuntimeHealthSnapshot(
  nowMs = Date.now(),
): RuntimeHealthSnapshot {
  return {
    status: "ok",
    ts: new Date(nowMs).toISOString(),
    uptimeSeconds: Math.max(
      0,
      Math.floor((nowMs - processStartedAtMs) / 1_000),
    ),
    bootstrap: bootstrapStatus,
    telegramPolling: telegramPollingStatus,
    db: databaseStatus,
  };
}

export function resetRuntimeHealthForTests(): void {
  bootstrapStatus = "pending";
  telegramPollingStatus = "disabled";
  databaseStatus = "unknown";
}
