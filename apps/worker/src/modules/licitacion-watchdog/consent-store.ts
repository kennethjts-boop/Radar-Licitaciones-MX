/** Consentimientos persistentes por licitación; sin consentimiento no hay vigilancia. */
import { getSupabaseClient } from "../../storage/client";
import { nowISO } from "../../core/time";

const PREFIX = "watchdog_consent:";
export interface WatchdogConsent {
  procurementId: string;
  label: string;
  status: "pending" | "approved" | "declined";
  chatId: string;
  messageId?: number;
  decidedAt?: string;
  decidedBy?: number;
}

export async function getWatchdogConsent(procurementId: string): Promise<WatchdogConsent | null> {
  const { data, error } = await getSupabaseClient().from("system_state")
    .select("value_json").eq("key", PREFIX + procurementId).maybeSingle();
  if (error) throw new Error(`No se pudo leer autorización watchdog: ${error.message}`);
  return data?.value_json as WatchdogConsent ?? null;
}

export async function createWatchdogConsent(consent: WatchdogConsent): Promise<void> {
  const { error } = await getSupabaseClient().from("system_state").upsert({
    key: PREFIX + consent.procurementId, value_json: consent, updated_at: nowISO(),
  }, { onConflict: "key", ignoreDuplicates: true });
  if (error) throw new Error(`No se pudo crear autorización watchdog: ${error.message}`);
}

/** Compare-and-set: una respuesta nunca sobreescribe una decisión anterior. */
export async function updatePendingConsent(consent: WatchdogConsent): Promise<boolean> {
  const { data, error } = await getSupabaseClient().from("system_state")
    .update({ value_json: consent, updated_at: nowISO() })
    .eq("key", PREFIX + consent.procurementId).eq("value_json->>status", "pending")
    .select("key");
  if (error) throw new Error(`No se pudo guardar autorización watchdog: ${error.message}`);
  return Boolean(data?.length);
}

export async function approvedWatchdogIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await getSupabaseClient().from("system_state")
    .select("value_json").in("key", ids.map((id) => PREFIX + id))
    .eq("value_json->>status", "approved");
  if (error) throw new Error(`No se pudieron verificar autorizaciones watchdog: ${error.message}`);
  return new Set((data ?? []).map((row) => (row.value_json as WatchdogConsent).procurementId));
}

export async function consentForReply(chatId: string, messageId: number): Promise<WatchdogConsent | null> {
  const { data, error } = await getSupabaseClient().from("system_state")
    .select("value_json").like("key", PREFIX + "%")
    .eq("value_json->>chatId", chatId).eq("value_json->>messageId", String(messageId))
    .limit(1).maybeSingle();
  if (error) throw new Error(`No se pudo leer respuesta watchdog: ${error.message}`);
  return data?.value_json as WatchdogConsent ?? null;
}
