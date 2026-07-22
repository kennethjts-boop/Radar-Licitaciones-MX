import { randomUUID } from "crypto";
import { getSupabaseClient } from "../../storage/client";
import { nowISO } from "../../core/time";
import type { TelegramDeliveryReceipt } from "../../alerts/telegram.alerts";
import type {
  StoredDetectedChanges,
  StructuralConfirmation,
  WatchdogChange,
  WatchdogSnapshot,
  WatchdogSnapshotRow,
  WatchdogFailureCause,
  WatchdogHealthSeverity,
} from "./types";

const HEALTH_ALERT_PREFIX = "licitacion_watchdog_health";

export interface WatchdogHealthAlertRow {
  id: string;
  alert_type: string;
  telegram_message: string;
  telegram_status: "pending" | "sent" | "failed";
  telegram_message_id: number | null;
  sent_at: string | null;
  created_at: string;
}

function healthAlertType(severity: WatchdogHealthSeverity, cause: WatchdogFailureCause): string {
  return `${HEALTH_ALERT_PREFIX}_${severity.toLowerCase()}_${cause.toLowerCase()}`;
}

export async function resolveExpediente(numeroProcedimiento: string): Promise<{
  expedienteUrl: string;
  uuidProcedimiento: string;
}> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("procurements")
    .select("source_url")
    .or(
      `external_id.eq.${numeroProcedimiento},procedure_number.eq.${numeroProcedimiento},licitation_number.eq.${numeroProcedimiento}`,
    )
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`No se pudo resolver expediente en Supabase: ${error.message}`);
  const expedienteUrl = data?.source_url as string | undefined;
  const uuidProcedimiento = expedienteUrl?.match(/\/detalle\/([^/]+)\/procedimiento/i)?.[1];
  if (!expedienteUrl || !uuidProcedimiento) {
    throw new Error(`Expediente ${numeroProcedimiento} no existe en BD o no tiene URL de detalle válida`);
  }
  return { expedienteUrl, uuidProcedimiento };
}

export async function getLatestSnapshot(numeroProcedimiento: string): Promise<WatchdogSnapshotRow | null> {
  const { data, error } = await getSupabaseClient()
    .from("watchdog_snapshots")
    .select("*")
    .eq("numero_procedimiento", numeroProcedimiento)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer snapshot watchdog: ${error.message}`);
  return data as WatchdogSnapshotRow | null;
}

export async function getPendingSnapshots(numeroProcedimiento: string): Promise<WatchdogSnapshotRow[]> {
  const { data, error } = await getSupabaseClient()
    .from("watchdog_snapshots")
    .select("*")
    .eq("numero_procedimiento", numeroProcedimiento)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`No se pudieron leer notificaciones watchdog pendientes: ${error.message}`);
  return ((data ?? []) as WatchdogSnapshotRow[])
    .filter((row) => row.detected_changes?.notification?.status === "pending")
    .reverse();
}

export async function getLastChangedSnapshot(numeroProcedimiento: string): Promise<WatchdogSnapshotRow | null> {
  const { data, error } = await getSupabaseClient()
    .from("watchdog_snapshots")
    .select("*")
    .eq("numero_procedimiento", numeroProcedimiento)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`No se pudo leer último cambio watchdog: ${error.message}`);
  return ((data ?? []) as WatchdogSnapshotRow[]).find((row) =>
    row.detected_changes?.notification?.kind === "change",
  ) ?? null;
}

export async function insertSnapshot(input: {
  numeroProcedimiento: string;
  hash: string;
  snapshot: WatchdogSnapshot;
  changes: WatchdogChange[];
  notificationKind: "baseline" | "baseline_completed" | "change";
  structuralConfirmation?: StructuralConfirmation;
}): Promise<WatchdogSnapshotRow> {
  const detectedChanges: StoredDetectedChanges = {
    changes: input.changes,
    notification: {
      kind: input.notificationKind,
      status: "pending",
      deploymentSha: input.snapshot.deploymentSha,
    },
    ...(input.structuralConfirmation
      ? { structuralConfirmation: input.structuralConfirmation }
      : {}),
  };
  const { data, error } = await getSupabaseClient()
    .from("watchdog_snapshots")
    .insert({
      numero_procedimiento: input.numeroProcedimiento,
      snapshot_hash: input.hash,
      snapshot_json: input.snapshot,
      detected_changes: detectedChanges,
    })
    .select("*")
    .single();
  if (error) throw new Error(`No se pudo guardar snapshot watchdog: ${error.message}`);
  return data as WatchdogSnapshotRow;
}

export async function markNotificationSent(
  row: WatchdogSnapshotRow,
  receipt: TelegramDeliveryReceipt,
): Promise<void> {
  const detectedChanges: StoredDetectedChanges = {
    ...row.detected_changes,
    notification: {
      ...row.detected_changes.notification,
      status: "sent",
      messageId: receipt.messageId,
      chatId: receipt.chatId,
      chatType: receipt.chatType,
      chatTitle: receipt.chatTitle,
      chatUsername: receipt.chatUsername,
      sentAt: nowISO(),
    },
  };
  const { error } = await getSupabaseClient()
    .from("watchdog_snapshots")
    .update({ detected_changes: detectedChanges })
    .eq("id", row.id);
  if (error) throw new Error(`No se pudo confirmar notificación watchdog: ${error.message}`);
}

export async function getRecentWatchdogHealthAlerts(
  severity: WatchdogHealthSeverity,
  limit = 20,
): Promise<WatchdogHealthAlertRow[]> {
  const { data, error } = await getSupabaseClient()
    .from("alerts")
    .select("id, alert_type, telegram_message, telegram_status, telegram_message_id, sent_at, created_at")
    .like("alert_type", `${HEALTH_ALERT_PREFIX}_${severity.toLowerCase()}_%`)
    .eq("telegram_status", "sent")
    .order("sent_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`No se pudo leer cooldown de alertas watchdog: ${error.message}`);
  return (data ?? []) as WatchdogHealthAlertRow[];
}

export async function createPendingWatchdogHealthAlert(input: {
  severity: WatchdogHealthSeverity;
  cause: WatchdogFailureCause;
  message: string;
}): Promise<string> {
  const id = randomUUID();
  const { error } = await getSupabaseClient().from("alerts").insert({
    id,
    radar_id: null,
    procurement_id: null,
    alert_type: healthAlertType(input.severity, input.cause),
    telegram_message: input.message,
    telegram_status: "pending",
    telegram_message_id: null,
    sent_at: null,
    created_at: nowISO(),
  });
  if (error) throw new Error(`No se pudo persistir alerta watchdog pendiente: ${error.message}`);
  return id;
}

export async function markWatchdogHealthAlertSent(
  id: string,
  messageId: number | null,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("alerts")
    .update({
      telegram_status: "sent",
      telegram_message_id: messageId,
      sent_at: nowISO(),
    })
    .eq("id", id);
  if (error) throw new Error(`No se pudo confirmar alerta watchdog enviada: ${error.message}`);
}

export async function markWatchdogHealthAlertFailed(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("alerts")
    .update({ telegram_status: "failed" })
    .eq("id", id);
  if (error) throw new Error(`No se pudo marcar alerta watchdog fallida: ${error.message}`);
}
