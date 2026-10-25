/**
 * El Watchdog solicita permiso por alertas NEW_MATCH realmente entregadas.
 * Sólo un Sí persistido permite activar la vigilancia.
 * Este módulo es idempotente y vuelve a conciliar las entregas si el alta
 * falló después de enviar Telegram (evita reenviar avisos para reintentar).
 */
import { getSupabaseClient } from "../../storage/client";
import { createModuleLogger } from "../../core/logger";
import { OPERATIONAL_FOCUS_KEYS } from "../../radars/operational-focus.matcher";
import { OPERATIONAL_RADAR_VERSION_KEY } from "../../radars/operational-version";
import { EDOMEX_FOCUS_KEYS, EDOMEX_RADAR_VERSION_KEY } from "../../radars/edomex-focus.matcher";
import { isSecogemProcurementUrl, requestEdomexPdfConsent } from "../edomex/consent";
import {
  evaluateNewTenderPublication,
  OPERATIONAL_PUBLICATION_CUTOFF,
} from "../operational-alerts/eligibility";
import { listPersistentTargets } from "./target-manager";

import { requestWatchdogConsent, activateApprovedConsent } from "./consent";
import { getWatchdogConsent } from "./consent-store";

const log = createModuleLogger("licitacion-watchdog:auto-activation");
const ALLOWED_RADARS = new Set<string>([
  ...Object.values(OPERATIONAL_FOCUS_KEYS),
  ...Object.values(EDOMEX_FOCUS_KEYS),
]);
const CURRENT_VERSION_KEYS = [OPERATIONAL_RADAR_VERSION_KEY, EDOMEX_RADAR_VERSION_KEY];

interface AlertProcurement {
  publication_date: string | null;
  procedure_number?: string | null;
  source_url?: string | null;
}

interface AlertCandidate {
  id: string;
  procurement_id: string | null;
  radar_id: string | null;
  alert_type: string;
  telegram_status: string;
  created_at: string;
  sent_at: string | null;
  radars: { key: string; is_active: boolean } | Array<{ key: string; is_active: boolean }> | null;
  procurements: AlertProcurement | AlertProcurement[] | null;
}

function single<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function isEligibleAlert(row: AlertCandidate): boolean {
  const radar = single(row.radars);
  const procurement = single(row.procurements);
  // La fecha de publicación puede estar ausente (`publication_date` NULL): la
  // existencia de la alerta `new_match` ya demuestra que fue evaluada como
  // elegible en el momento de crearse, así que no se descarta la vigilancia
  // por un dato que hoy no está disponible.
  const publicationDate = procurement?.publication_date ?? null;
  const publicationEligible =
    publicationDate === null || evaluateNewTenderPublication(publicationDate).eligible;
  return row.alert_type === "new_match" &&
    row.telegram_status === "sent" &&
    Boolean(row.procurement_id && row.radar_id && row.sent_at) &&
    Boolean(radar?.is_active && ALLOWED_RADARS.has(radar.key)) &&
    publicationEligible &&
    Date.parse(row.created_at) >= OPERATIONAL_PUBLICATION_CUTOFF.getTime() &&
    Date.parse(row.sent_at ?? "") >= OPERATIONAL_PUBLICATION_CUTOFF.getTime();
}

async function hasCurrentOctoberMatch(row: AlertCandidate): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from("matches")
    .select("id, radar_config_versions!inner(version_key)")
    .eq("procurement_id", row.procurement_id!)
    .eq("radar_id", row.radar_id!)
    .in("radar_config_versions.version_key", CURRENT_VERSION_KEYS)
    .limit(1);
  if (error) throw new Error(`No se pudo comprobar match vigente: ${error.message}`);
  return Boolean(data?.length);
}

async function activateCandidate(
  row: AlertCandidate,
  existingTargets?: Awaited<ReturnType<typeof listPersistentTargets>>,
): Promise<boolean> {
  if (!isEligibleAlert(row) || !(await hasCurrentOctoberMatch(row))) return false;

  // Una convocatoria de SECOGEM sólo admite comparar su PDF oficial: no pasa
  // por el watchdog de expedientes de ComprasMX.
  const alertProcurement = single(row.procurements);
  if (isSecogemProcurementUrl(alertProcurement?.source_url)) {
    return requestEdomexPdfConsent(row.procurement_id!);
  }

  const targets = existingTargets ?? await listPersistentTargets(false);
  if (!targets) throw new Error("No existe tabla persistente watchdog_targets");
  const previous = targets.find((target) => target.procurementId === row.procurement_id);
  const consent = await getWatchdogConsent(row.procurement_id!);
  if (consent?.status === "approved") return activateApprovedConsent(consent);
  if (consent?.status === "declined") return false;

  // /novigilar tiene precedencia sobre esta misma alerta, incluso al reconciliar.
  if (previous?.deactivatedAt &&
      Date.parse(previous.deactivatedAt) >= Date.parse(row.sent_at!)) {
    return false;
  }

  const procurement = single(row.procurements);
  const label = previous?.alias || procurement?.procedure_number || row.procurement_id!;
  return requestWatchdogConsent(row.procurement_id!, label);
}

/** Inmediato: se invoca sólo DESPUÉS de marcar la entrega exitosa. */
export async function activateWatchdogForSentAlert(alertId: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from("alerts")
    .select("id,procurement_id,radar_id,alert_type,telegram_status,created_at,sent_at,radars!inner(key,is_active),procurements!inner(publication_date,procedure_number,source_url)")
    .eq("id", alertId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo consultar alerta watchdog: ${error.message}`);
  return data ? activateCandidate(data as AlertCandidate) : false;
}

/**
 * Recupera solicitudes pendientes y altas ya aprobadas tras cortes de red.
 * Sólo revisa alertas de octubre ya entregadas y con radar vigente.
 */
export async function reconcileWatchdogFromSentAlerts(): Promise<number> {
  const { data, error } = await getSupabaseClient()
    .from("alerts")
    .select("id,procurement_id,radar_id,alert_type,telegram_status,created_at,sent_at,radars!inner(key,is_active),procurements!inner(publication_date,procedure_number,source_url)")
    .eq("alert_type", "new_match")
    .eq("telegram_status", "sent")
    .eq("radars.is_active", true)
    .gte("created_at", OPERATIONAL_PUBLICATION_CUTOFF.toISOString())
    .order("sent_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(`No se pudieron conciliar alertas watchdog: ${error.message}`);

  const targets = await listPersistentTargets(false);
  if (!targets) throw new Error("No existe tabla persistente watchdog_targets");

  let activated = 0;
  for (const row of (data ?? []) as AlertCandidate[]) {
    try {
      if (activated >= 10) break;
      if (await activateCandidate(row, targets)) {
        activated++;
        // Evita múltiples upserts de una misma licitación en esta pasada.
        const target = await listPersistentTargets(false);
        if (target) targets.splice(0, targets.length, ...target);
      }
    } catch (err) {
      log.warn({ err, alertId: row.id }, "No se pudo conciliar una autorización watchdog");
    }
  }
  return activated;
}
