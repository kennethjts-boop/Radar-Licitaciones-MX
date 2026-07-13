import { getSupabaseClient } from "../../storage/client";
import { nowISO } from "../../core/time";
import type {
  StoredDetectedChanges,
  WatchdogChange,
  WatchdogSnapshot,
  WatchdogSnapshotRow,
} from "./types";

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
}): Promise<WatchdogSnapshotRow> {
  const detectedChanges: StoredDetectedChanges = {
    changes: input.changes,
    notification: { kind: input.notificationKind, status: "pending" },
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

export async function markNotificationSent(row: WatchdogSnapshotRow, messageId: number | null): Promise<void> {
  const detectedChanges: StoredDetectedChanges = {
    ...row.detected_changes,
    notification: {
      ...row.detected_changes.notification,
      status: "sent",
      messageId,
      sentAt: nowISO(),
    },
  };
  const { error } = await getSupabaseClient()
    .from("watchdog_snapshots")
    .update({ detected_changes: detectedChanges })
    .eq("id", row.id);
  if (error) throw new Error(`No se pudo confirmar notificación watchdog: ${error.message}`);
}
