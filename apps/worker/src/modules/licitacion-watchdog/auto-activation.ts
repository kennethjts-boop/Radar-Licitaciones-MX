/**
 * El Watchdog sólo se activa por alertas NEW_MATCH realmente entregadas.
 * Este módulo es idempotente y vuelve a conciliar las entregas si el alta
 * falló después de enviar Telegram (evita reenviar avisos para reintentar).
 */
import { getSupabaseClient } from "../../storage/client";
import { createModuleLogger } from "../../core/logger";
import { OPERATIONAL_FOCUS_KEYS } from "../../radars/operational-focus.matcher";
import {
  evaluateNewTenderPublication,
  OPERATIONAL_PUBLICATION_CUTOFF,
} from "../operational-alerts/eligibility";
import { activateWatchdogTarget, listPersistentTargets } from "./target-manager";

const log = createModuleLogger("licitacion-watchdog:auto-activation");
const OCTOBER_VERSION = "operational_20261014";
const ALLOWED_RADARS = new Set<string>(Object.values(OPERATIONAL_FOCUS_KEYS));

interface AlertCandidate {
  id: string;
  procurement_id: string | null;
  radar_id: string | null;
  alert_type: string;
  telegram_status: string;
  created_at: string;
  sent_at: string | null;
  radars: { key: string; is_active: boolean } | Array<{ key: string; is_active: boolean }> | null;
  procurements: { publication_date: string | null } | Array<{ publication_date: string | null }> | null;
}

function single<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function isEligibleAlert(row: AlertCandidate): boolean {
  const radar = single(row.radars);
  const procurement = single(row.procurements);
  return row.alert_type === "new_match" &&
    row.telegram_status === "sent" &&
    Boolean(row.procurement_id && row.radar_id && row.sent_at) &&
    Boolean(radar?.is_active && ALLOWED_RADARS.has(radar.key)) &&
    Boolean(procurement && evaluateNewTenderPublication(procurement.publication_date).eligible) &&
    Date.parse(row.created_at) >= OPERATIONAL_PUBLICATION_CUTOFF.getTime() &&
    Date.parse(row.sent_at ?? "") >= OPERATIONAL_PUBLICATION_CUTOFF.getTime();
}

async function hasCurrentOctoberMatch(row: AlertCandidate): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from("matches")
    .select("id, radar_config_versions!inner(version_key)")
    .eq("procurement_id", row.procurement_id!)
    .eq("radar_id", row.radar_id!)
    .eq("radar_config_versions.version_key", OCTOBER_VERSION)
    .limit(1);
  if (error) throw new Error(`No se pudo comprobar match de octubre: ${error.message}`);
  return Boolean(data?.length);
}

async function activateCandidate(
  row: AlertCandidate,
  existingTargets?: Awaited<ReturnType<typeof listPersistentTargets>>,
): Promise<boolean> {
  if (!isEligibleAlert(row) || !(await hasCurrentOctoberMatch(row))) return false;

  const targets = existingTargets ?? await listPersistentTargets(false);
  if (!targets) throw new Error("No existe tabla persistente watchdog_targets");
  const previous = targets.find((target) => target.procurementId === row.procurement_id);
  if (previous?.active) return false;

  // /novigilar tiene precedencia sobre esta misma alerta, incluso al reconciliar.
  if (previous?.deactivatedAt &&
      Date.parse(previous.deactivatedAt) >= Date.parse(row.sent_at!)) {
    return false;
  }

  await activateWatchdogTarget(row.procurement_id!);
  log.info(
    { procurementId: row.procurement_id, alertId: row.id },
    "Watchdog activado por alerta de octubre enviada a Telegram",
  );
  return true;
}

/** Inmediato: se invoca sólo DESPUÉS de marcar la entrega exitosa. */
export async function activateWatchdogForSentAlert(alertId: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from("alerts")
    .select("id,procurement_id,radar_id,alert_type,telegram_status,created_at,sent_at,radars!inner(key,is_active),procurements!inner(publication_date)")
    .eq("id", alertId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo consultar alerta watchdog: ${error.message}`);
  return data ? activateCandidate(data as AlertCandidate) : false;
}

/**
 * Recupera activaciones tras cortes de red sin volver a enviar Telegram.
 * Sólo revisa alertas de octubre ya entregadas y con radar vigente.
 */
export async function reconcileWatchdogFromSentAlerts(): Promise<number> {
  const { data, error } = await getSupabaseClient()
    .from("alerts")
    .select("id,procurement_id,radar_id,alert_type,telegram_status,created_at,sent_at,radars!inner(key,is_active),procurements!inner(publication_date)")
    .eq("alert_type", "new_match")
    .eq("telegram_status", "sent")
    .eq("radars.is_active", true)
    .gte("created_at", OPERATIONAL_PUBLICATION_CUTOFF.toISOString())
    .gte("procurements.publication_date", "2026-10-14")
    .order("sent_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(`No se pudieron conciliar alertas watchdog: ${error.message}`);

  const targets = await listPersistentTargets(false);
  if (!targets) throw new Error("No existe tabla persistente watchdog_targets");

  let activated = 0;
  for (const row of (data ?? []) as AlertCandidate[]) {
    try {
      if (await activateCandidate(row, targets)) {
        activated++;
        // Evita múltiples upserts de una misma licitación en esta pasada.
        const target = await listPersistentTargets(false);
        if (target) targets.splice(0, targets.length, ...target);
      }
    } catch (err) {
      log.warn({ err, alertId: row.id }, "No se pudo recuperar un alta automática watchdog");
    }
  }
  return activated;
}
