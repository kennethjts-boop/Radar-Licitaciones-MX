/**
 * MATCH & ALERT REPOSITORIES
 */
import { v4 as uuidv4 } from "uuid";
import { getSupabaseClient } from "./client";
import { StorageError } from "../core/errors";
import { nowISO } from "../core/time";
import type { DbMatch, DbAlert } from "../types/database";
import type { MatchResult, EnrichedAlert } from "../types/procurement";

// ─── Matches ─────────────────────────────────────────────────────────────────

export async function upsertMatch(
  match: MatchResult,
  radarDbId: string,
): Promise<{ isNew: boolean; matchId: string }> {
  const db = getSupabaseClient();

  // Verificar si ya existe
  const { data: existing } = await db
    .from("matches")
    .select("id")
    .eq("radar_id", radarDbId)
    .eq("procurement_id", match.procurementId)
    .single();

  const now = nowISO();

  if (existing) {
    await db
      .from("matches")
      .update({
        match_score: match.matchScore,
        match_level: match.matchLevel,
        matched_terms_json: match.matchedTerms,
        excluded_terms_json: match.excludedTerms,
        explanation: match.explanation,
        updated_at: now,
      })
      .eq("id", existing.id);

    return { isNew: false, matchId: existing.id };
  }

  const id = uuidv4();
  const record: DbMatch = {
    id,
    radar_id: radarDbId,
    procurement_id: match.procurementId,
    match_score: match.matchScore,
    match_level: match.matchLevel,
    matched_terms_json: match.matchedTerms,
    excluded_terms_json: match.excludedTerms,
    explanation: match.explanation,
    created_at: now,
    updated_at: now,
  };

  const { error } = await db.from("matches").insert(record);
  if (error) {
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

export async function markAlertFailed(alertId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("alerts")
    .update({ telegram_status: "failed" })
    .eq("id", alertId);

  if (error) {
    throw new StorageError(
      `Error marcando alerta fallida: ${error.message}`,
      "mark_failed",
    );
  }
}
