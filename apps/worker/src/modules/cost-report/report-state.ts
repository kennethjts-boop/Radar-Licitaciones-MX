/**
 * Estado del reporte por día en system_state (clave cost_report:YYYY-MM-DD).
 *
 * Un solo envío por día aun con reinicios o instancias solapadas:
 * - El primer intento se reclama con INSERT (la PK de system_state rechaza
 *   un segundo INSERT de la misma clave).
 * - Un reintento sólo procede desde status=failed con compare-and-set sobre
 *   (status, attempts); dos instancias no pueden ganar el mismo intento.
 * - status=claimed (en curso o proceso muerto) y status=uncertain (timeout:
 *   Telegram pudo haberlo entregado) NUNCA se reenvían automáticamente.
 */
import { getSupabaseClient } from "../../storage/client";
import type { DayCostMetrics } from "./types";

export type ReportStatus = "claimed" | "sent" | "failed" | "uncertain";

export interface ReportState {
  status: ReportStatus;
  attempts: number;
  claimedBy: string;
  claimedAt: string;
  sentAt?: string | null;
  messageId?: number | null;
  error?: string | null;
  metrics?: DayCostMetrics | null;
}

export interface StateStore {
  insertIfAbsent(key: string, value: object): Promise<boolean>;
  read<T>(key: string): Promise<T | null>;
  readMany<T>(keys: string[]): Promise<Map<string, T>>;
  /** Reemplaza el valor sólo si status y attempts siguen siendo los esperados. */
  compareAndSet(key: string, expected: { status: string; attempts: number }, value: object): Promise<boolean>;
  write(key: string, value: object): Promise<void>;
}

export const reportKey = (date: string) => `cost_report:${date}`;
export const snapshotKey = (provider: string, date: string) => `cost_snapshot:${provider}:${date}`;

export type ClaimResult =
  | { claimed: true; attempt: number }
  | { claimed: false; reason: "already_sent" | "in_progress_or_uncertain" | "max_attempts" | "lost_race" };

export async function claimReport(
  store: StateStore,
  date: string,
  instanceId: string,
  maxAttempts: number,
  now: Date = new Date(),
): Promise<ClaimResult> {
  const key = reportKey(date);
  const first: ReportState = { status: "claimed", attempts: 1, claimedBy: instanceId, claimedAt: now.toISOString() };
  if (await store.insertIfAbsent(key, first)) return { claimed: true, attempt: 1 };

  const existing = await store.read<ReportState>(key);
  if (!existing) return { claimed: false, reason: "lost_race" };
  if (existing.status === "sent") return { claimed: false, reason: "already_sent" };
  if (existing.status !== "failed") return { claimed: false, reason: "in_progress_or_uncertain" };
  if (existing.attempts >= maxAttempts) return { claimed: false, reason: "max_attempts" };

  const next: ReportState = {
    ...existing,
    status: "claimed",
    attempts: existing.attempts + 1,
    claimedBy: instanceId,
    claimedAt: now.toISOString(),
  };
  const won = await store.compareAndSet(key, { status: "failed", attempts: existing.attempts }, next);
  return won ? { claimed: true, attempt: next.attempts } : { claimed: false, reason: "lost_race" };
}

export function supabaseStateStore(): StateStore {
  const table = () => getSupabaseClient().from("system_state");
  return {
    async insertIfAbsent(key, value) {
      const { error } = await table().insert({ key, value_json: value, updated_at: new Date().toISOString() });
      if (!error) return true;
      if (error.code === "23505") return false;
      throw new Error(`system_state insert ${key}: ${error.message}`);
    },
    async read<T>(key: string) {
      const { data, error } = await table().select("value_json").eq("key", key).maybeSingle();
      if (error) throw new Error(`system_state read ${key}: ${error.message}`);
      return (data?.value_json as T) ?? null;
    },
    async readMany<T>(keys: string[]) {
      const out = new Map<string, T>();
      if (!keys.length) return out;
      const { data, error } = await table().select("key,value_json").in("key", keys);
      if (error) throw new Error(`system_state readMany: ${error.message}`);
      for (const row of data ?? []) out.set(row.key as string, row.value_json as T);
      return out;
    },
    async compareAndSet(key, expected, value) {
      const { data, error } = await table()
        .update({ value_json: value, updated_at: new Date().toISOString() })
        .eq("key", key)
        .eq("value_json->>status", expected.status)
        .eq("value_json->>attempts", String(expected.attempts))
        .select("key");
      if (error) throw new Error(`system_state CAS ${key}: ${error.message}`);
      return (data ?? []).length === 1;
    },
    async write(key, value) {
      const { error } = await table().upsert(
        { key, value_json: value, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
      if (error) throw new Error(`system_state write ${key}: ${error.message}`);
    },
  };
}
