/** Persistencia en `system_state` (sin migraciones): estado confirmado y bandeja por procedimiento. */
import { getSupabaseClient } from "../../storage/client";
import { nowISO } from "../../core/time";
import type { OutboxEntry, WatchSnapshot } from "./types";
import type { OutboxStore } from "./outbox";

const STATE = "priority_watch_state:";
const OUTBOX = "priority_watch_outbox:";

export interface PartidasCoverage {
  /** ok = lista completa; transient = incompleta en este ciclo; degraded = persiste (≥3 ciclos seguidos). */
  status: "ok" | "transient" | "degraded";
  since: string | null;
  consecutive: number;
  reason: string | null;
}

export interface WatchState {
  baseline: WatchSnapshot | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  consecutiveFailures: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  partidasCoverage: PartidasCoverage;
  /** Lo que no pudo confirmarse en la lectura inicial; se avisa cuando aparezca evidencia oficial. */
  pendingVerification: string[];
  initialReport: Record<string, unknown> | null;
}

export const emptyState = (): WatchState => ({
  baseline: null, lastSuccessAt: null, lastAttemptAt: null, consecutiveFailures: 0, nextAttemptAt: null, lastError: null,
  partidasCoverage: { status: "ok", since: null, consecutive: 0, reason: null }, pendingVerification: [], initialReport: null,
});

export interface StateStore {
  load(procedure: string): Promise<WatchState>;
  save(procedure: string, state: WatchState): Promise<void>;
}

async function read<T>(key: string): Promise<T | null> {
  const { data, error } = await getSupabaseClient().from("system_state").select("value_json").eq("key", key).maybeSingle();
  if (error) throw new Error(`vigilancia prioritaria: no se pudo leer ${key}: ${error.message}`);
  return (data?.value_json as T) ?? null;
}
async function write(key: string, value: object): Promise<void> {
  const { error } = await getSupabaseClient().from("system_state").upsert({ key, value_json: value, updated_at: nowISO() }, { onConflict: "key" });
  if (error) throw new Error(`vigilancia prioritaria: no se pudo guardar ${key}: ${error.message}`);
}

export const dbStateStore: StateStore = {
  load: async (procedure) => ({ ...emptyState(), ...((await read<WatchState>(STATE + procedure)) ?? {}) }),
  save: (procedure, state) => write(STATE + procedure, state),
};
export const dbOutboxStore: OutboxStore = {
  load: async (procedure) => (await read<{ entries?: OutboxEntry[] }>(OUTBOX + procedure))?.entries ?? [],
  save: (procedure, entries) => write(OUTBOX + procedure, { entries }),
};
