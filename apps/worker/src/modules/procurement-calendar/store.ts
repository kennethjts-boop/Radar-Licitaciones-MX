/** Persistencia del calendario en `system_state` (sin migraciones nuevas). */
import { getSupabaseClient } from "../../storage/client";
import { nowISO } from "../../core/time";
import type { CalendarSnapshot } from "./types";

const SNAPSHOT = "calendar_snapshot:";
const TRACKING = "calendar_tracking:";
const NOTIFIED = "calendar_notified:";
const BUTTONS = "calendar_buttons:";

export interface TrackingState {
  enabled: boolean;
  chatId?: string;
  by?: number;
  enabledAt?: string;
  disabledAt?: string;
  lastFailureAt?: string | null;
  consecutiveFailures?: number;
}
export interface ButtonsState {
  messageId: number;
  attachedAt: string;
  ok: boolean;
  error?: string;
}

async function read<T>(key: string): Promise<T | null> {
  const { data, error } = await getSupabaseClient().from("system_state").select("value_json").eq("key", key).maybeSingle();
  if (error) throw new Error(`calendario: no se pudo leer ${key}: ${error.message}`);
  return (data?.value_json as T) ?? null;
}
async function write(key: string, value: object): Promise<void> {
  const { error } = await getSupabaseClient().from("system_state")
    .upsert({ key, value_json: value, updated_at: nowISO() }, { onConflict: "key" });
  if (error) throw new Error(`calendario: no se pudo guardar ${key}: ${error.message}`);
}

export const getSnapshot = (id: string) => read<CalendarSnapshot>(SNAPSHOT + id);
export const saveSnapshot = (snapshot: CalendarSnapshot) => write(SNAPSHOT + snapshot.procurementId, snapshot);
export const getTracking = (id: string) => read<TrackingState>(TRACKING + id);
export const saveTracking = (id: string, state: TrackingState) => write(TRACKING + id, state);
export const getButtons = (id: string) => read<ButtonsState>(BUTTONS + id);
export const saveButtons = (id: string, state: ButtonsState) => write(BUTTONS + id, state);

/** Guardia contra duplicados por caída entre el envío y el asiento del calendario. */
const GUARD_MS = 6 * 60 * 60 * 1000;

export async function getNotifiedKeys(id: string, nowMs = Date.now()): Promise<Set<string>> {
  const value = await read<{ sent?: Record<string, string> }>(NOTIFIED + id);
  return new Set(Object.entries(value?.sent ?? {})
    .filter(([, at]) => nowMs - Date.parse(at) < GUARD_MS).map(([key]) => key));
}
export async function addNotifiedKeys(id: string, keys: string[], at = nowISO()): Promise<void> {
  const value = await read<{ sent?: Record<string, string> }>(NOTIFIED + id);
  const sent = { ...(value?.sent ?? {}) };
  keys.forEach((key) => { sent[key] = at; });
  const recent = Object.entries(sent).sort((x, y) => y[1].localeCompare(x[1])).slice(0, 100);
  await write(NOTIFIED + id, { sent: Object.fromEntries(recent) });
}

/** Expedientes con seguimiento explícitamente activo. */
export async function listTrackedProcurementIds(): Promise<string[]> {
  const { data, error } = await getSupabaseClient().from("system_state").select("key,value_json")
    .like("key", TRACKING + "%").eq("value_json->>enabled", "true");
  if (error) throw new Error(`calendario: no se pudo listar seguimientos: ${error.message}`);
  return (data ?? []).map((row) => String(row.key).slice(TRACKING.length));
}
