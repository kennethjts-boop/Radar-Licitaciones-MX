/**
 * MATCH & ALERT REPOSITORIES
 */
import { v4 as uuidv4 } from "uuid";
import { getSupabaseClient } from "./client";
import { StorageError } from "../core/errors";
import { nowISO } from "../core/time";
import { createModuleLogger } from "../core/logger";
import type { DbMatch, DbAlert } from "../types/database";
import type { MatchResult, EnrichedAlert } from "../types/procurement";
import { OPERATIONAL_FOCUS_KEYS } from "../radars/operational-focus.matcher";
import { OPERATIONAL_RADAR_VERSION_KEY } from "../radars/operational-version";
import { OPERATIONAL_PUBLICATION_CUTOFF_DATE } from "../modules/operational-alerts/eligibility";

const log = createModuleLogger("match-alert-repo");

// ─── Matches ─────────────────────────────────────────────────────────────────

export async function upsertMatch(
  match: MatchResult,
  radarDbId: string,
): Promise<{ isNew: boolean; matchId: string }> {
  const db = getSupabaseClient();

  const documentScore = match.documentScore ?? 0;
  const opportunityScore = match.opportunityScore ?? 0;

  const { data: configVersion, error: configVersionError } = await db
    .from("radar_config_versions")
    .select("id, version_key")
    .eq("radar_id", radarDbId)
    .is("effective_to", null)
    .single();

  if (configVersionError || !configVersion) {
    throw new StorageError(
      `Configuración vigente no encontrada para radar ${radarDbId}: ${configVersionError?.message ?? "sin fila"}`,
      "find_radar_config_version",
    );
  }
  if (
    Object.values(OPERATIONAL_FOCUS_KEYS).includes(match.radarKey as never) &&
    configVersion.version_key !== OPERATIONAL_RADAR_VERSION_KEY
  ) {
    throw new StorageError(
      `La migración de octubre no está activa para ${match.radarKey} ` +
      `(versión vigente: ${configVersion.version_key ?? "desconocida"}, ` +
      `esperada: ${OPERATIONAL_RADAR_VERSION_KEY})`,
      "find_radar_config_version",
    );
  }

  // Verificar si ya existe
  const { data: existing, error: existingError } = await db
    .from("matches")
    .select("id")
    .eq("radar_config_version_id", configVersion.id)
    .eq("procurement_id", match.procurementId)
    .maybeSingle();

  if (existingError) {
    log.error(
      {
        code: existingError.code,
        msg: existingError.message,
        radarDbId,
        procurementId: match.procurementId,
      },
      "Error buscando match existente",
    );
    throw new StorageError(
      `Error buscando match existente: ${existingError.message}`,
      "find_match",
    );
  }

  const now = nowISO();

  if (existing) {
    const { error: updateError } = await db
      .from("matches")
      .update({
        match_score: match.matchScore,
        opportunity_score: opportunityScore,
        document_score: documentScore,
        match_level: match.matchLevel,
        matched_terms_json: match.matchedTerms,
        excluded_terms_json: match.excludedTerms,
        explanation: match.explanation,
        updated_at: now,
      })
      .eq("id", existing.id);

    if (updateError) {
      log.error(
        {
          code: updateError.code,
          msg: updateError.message,
          matchId: existing.id,
          radarDbId,
          procurementId: match.procurementId,
        },
        "Error actualizando match existente",
      );
      throw new StorageError(
        `Error actualizando match: ${updateError.message}`,
        "update_match",
      );
    }

    return { isNew: false, matchId: existing.id };
  }

  const id = uuidv4();
  const record: DbMatch = {
    id,
    radar_id: radarDbId,
    radar_config_version_id: configVersion.id,
    procurement_id: match.procurementId,
    match_score: match.matchScore,
    opportunity_score: opportunityScore,
    document_score: documentScore,
    match_level: match.matchLevel,
    matched_terms_json: match.matchedTerms,
    excluded_terms_json: match.excludedTerms,
    explanation: match.explanation,
    created_at: now,
    updated_at: now,
  };

  const { error } = await db.from("matches").insert(record);
  if (error) {
    log.error(
      {
        code: error.code,
        msg: error.message,
        radarDbId,
        procurementId: match.procurementId,
      },
      "Error insertando match",
    );
    throw new StorageError(
      `Error insertando match: ${error.message}`,
      "insert_match",
    );
  }

  return { isNew: true, matchId: id };
}

export async function getMatchesByRadar(
  radarDbId: string,
  limit = 50,
): Promise<DbMatch[]> {
  const { data, error } = await getSupabaseClient()
    .from("matches")
    .select("*")
    .eq("radar_id", radarDbId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new StorageError(error.message, "get_matches");
  return data ?? [];
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

export async function createAlert(
  enrichedAlert: EnrichedAlert,
  dbProcurementId?: string,
  radarDbId?: string,
): Promise<string> {
  const db = getSupabaseClient();
  const id = uuidv4();
  const now = nowISO();

  const record: DbAlert = {
    id,
    radar_id: radarDbId ?? null,
    procurement_id: dbProcurementId ?? null, // UUID de DB cuando está disponible
    alert_type: enrichedAlert.alertType,
    telegram_message: enrichedAlert.telegramMessage,
    telegram_status: "pending",
    telegram_message_id: null,
    dedupe_key: null,
    sent_at: null,
    created_at: now,
  };

  const { error } = await db.from("alerts").insert(record);
  if (error) {
    throw new StorageError(
      `Error creando alerta: ${error.message}`,
      "create_alert",
    );
  }

  return id;
}

export async function ensurePendingNewTenderAlert(
  enrichedAlert: EnrichedAlert,
  dbProcurementId: string,
  radarDbId?: string,
): Promise<{ alertId: string; created: boolean; status: "pending" | "sent" | "failed" }> {
  const db = getSupabaseClient();
  const dedupeKey = `new_match:${dbProcurementId}`;
  const { data: existing, error: findError } = await db
    .from("alerts")
    .select("id, telegram_status")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (findError && findError.code !== "PGRST116") {
    throw new StorageError(findError.message, "find_new_alert");
  }
  if (existing) {
    // Una alerta marcada como 'failed' es terminal: se registró porque Telegram
    // la rechazó de forma definitiva (payload inválido, chat bloqueado) y
    // reintentarla en automático sólo produce el mismo rechazo una y otra vez.
    // La recuperación es explícita y queda a cargo del operador vía /perdidas.
    return {
      alertId: existing.id,
      created: false,
      status: existing.telegram_status as "pending" | "sent" | "failed",
    };
  }

  const id = uuidv4();
  const { error } = await db.from("alerts").insert({
    id,
    radar_id: radarDbId ?? null,
    procurement_id: dbProcurementId,
    alert_type: "new_match",
    telegram_message: enrichedAlert.telegramMessage,
    telegram_status: "pending",
    telegram_message_id: null,
    sent_at: null,
    created_at: nowISO(),
    dedupe_key: dedupeKey,
  });
  if (!error) return { alertId: id, created: true, status: "pending" };
  if (error.code !== "23505") {
    throw new StorageError(error.message, "insert_new_alert");
  }
  const { data: raced, error: raceError } = await db
    .from("alerts")
    .select("id, telegram_status")
    .eq("dedupe_key", dedupeKey)
    .single();
  if (raceError || !raced) {
    throw new StorageError(raceError?.message ?? "Alerta concurrente no encontrada", "find_new_alert");
  }
  return {
    alertId: raced.id,
    created: false,
    status: raced.telegram_status as "pending" | "sent" | "failed",
  };
}

export interface PendingNewTenderAlertRow {
  id: string;
  telegramMessage: string;
}

/**
 * Lee la cola de alertas nuevas pendientes de entrega.
 *
 * El corte de publicación se evalúa en memoria y NO con `.gte()` en la consulta:
 * `publication_date` puede quedar en NULL cuando el listado de ComprasMX no
 * expone la fecha (sólo el detalle la trae) y ese NULL hacía que la alerta
 * quedara huérfana en la base, invisible para la cola y sin ningún reintento
 * posterior. Una alerta que llegó a crearse ya fue evaluada como elegible en
 * su momento, así que un NULL actual no debe ocultarla.
 */
export async function getPendingNewTenderAlerts(limit = 500): Promise<PendingNewTenderAlertRow[]> {
  const { data, error } = await getSupabaseClient()
    .from("alerts")
    .select("id, telegram_message, procurements!inner(publication_date), radars!inner(is_active)")
    .eq("alert_type", "new_match")
    .eq("telegram_status", "pending")
    .not("dedupe_key", "is", null)
    .eq("radars.is_active", true)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new StorageError(error.message, "get_pending_new_alerts");
  return (data ?? [])
    .filter((row) => isPublicationDateWithinOperationalCutoff(row.procurements))
    .map((row) => ({
      id: row.id,
      telegramMessage: row.telegram_message,
    }));
}

/**
 * Una alerta es entregable si su fecha de publicación es posterior al corte
 * operativo o si la fecha no es verificable (nunca se vació un dato ya
 * confirmado; ver `upsertProcurement`).
 */
function isPublicationDateWithinOperationalCutoff(
  procurement:
    | { publication_date?: string | null }
    | Array<{ publication_date?: string | null }>
    | null
    | undefined,
): boolean {
  const first = Array.isArray(procurement) ? procurement[0] : procurement;
  const publicationDate = first?.publication_date;
  if (!publicationDate) return true;
  return publicationDate >= OPERATIONAL_PUBLICATION_CUTOFF_DATE;
}

/**
 * Retorna true si ya existe una alerta enviada (telegram_status = 'sent')
 * para este procurement (por UUID de DB).
 * Usado en runRecheckJob para evitar re-alertar registros sin cambios.
 */
export async function hasExistingAlert(dbProcurementId: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from("alerts")
    .select("id")
    .eq("procurement_id", dbProcurementId)
    .eq("telegram_status", "sent")
    .limit(1);

  if (error) return false; // en caso de error, no suprimir (seguro)
  return (data ?? []).length > 0;
}

export async function markAlertSent(
  alertId: string,
  telegramMessageId: number,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("alerts")
    .update({
      telegram_status: "sent",
      telegram_message_id: telegramMessageId,
      sent_at: nowISO(),
    })
    .eq("id", alertId);

  if (error) {
    throw new StorageError(
      `Error marcando alerta enviada: ${error.message}`,
      "mark_sent",
    );
  }
}

/**
 * Marca una alerta como no entregable.
 *
 * `telegramMessageId` se registra cuando el mensaje **sí** llegó a Telegram y
 * lo que falló fue el bookkeeping en base de datos. Conservar ese identificador
 * permite distinguir "nunca se entregó" de "se entregó pero no se pudo asentar"
 * y evita que la recuperación manual reenvíe un mensaje ya visto por el
 * operador (duplicado).
 */
export async function markAlertFailed(
  alertId: string,
  telegramMessageId?: number | null,
): Promise<void> {
  const update: Record<string, unknown> = { telegram_status: "failed" };
  if (typeof telegramMessageId === "number" && Number.isFinite(telegramMessageId)) {
    update.telegram_message_id = telegramMessageId;
    update.sent_at = nowISO();
  }
  const { error } = await getSupabaseClient()
    .from("alerts")
    .update(update)
    .eq("id", alertId);

  if (error) {
    throw new StorageError(
      `Error marcando alerta fallida: ${error.message}`,
      "mark_failed",
    );
  }
}

export async function getLastSentAlert(): Promise<DbAlert | null> {
  const { data, error } = await getSupabaseClient()
    .from("alerts")
    .select("*")
    .eq("telegram_status", "sent")
    .order("sent_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new StorageError(
      `Error obteniendo última alerta enviada: ${error.message}`,
      "get_last_sent_alert",
    );
  }

  return data ?? null;
}
