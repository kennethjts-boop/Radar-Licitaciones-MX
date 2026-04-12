/**
 * PROCUREMENT REPOSITORY — Operaciones de lectura/escritura de expedientes.
 */
import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { getSupabaseClient } from "./client";
import { StorageError } from "../core/errors";
import { nowISO } from "../core/time";
import { createModuleLogger } from "../core/logger";
import { detectChangedFields } from "../core/fingerprints";
import type { NormalizedProcurement } from "../types/procurement";
import type {
  DbProcurement,
  DbProcurementVersion,
  DbAttachment,
} from "../types/database";

const log = createModuleLogger("procurement-repo");

// ─── Upsert principal ────────────────────────────────────────────────────────

export interface UpsertProcurementResult {
  isNew: boolean;
  isUpdated: boolean;
  procurementId: string;
  changedFields: Record<string, { prev: unknown; next: unknown }>;
  versionNumber: number;
}

/**
 * Inserta o actualiza un expediente.
 * Si ya existe (mismo source + external_id):
 *   - Compara canonical_fingerprint
 *   - Si cambió → crea nueva versión y registra campos cambiados
 *   - Si no cambió → solo actualiza last_seen_at
 */
export async function upsertProcurement(
  normalized: NormalizedProcurement,
  sourceId: string,
): Promise<UpsertProcurementResult> {
  const db = getSupabaseClient();

  // Buscar existente
  const { data: existing, error: findError } = await db
    .from("procurements")
    .select("*")
    .eq("source_id", sourceId)
    .eq("external_id", normalized.externalId)
    .single();

  if (findError && findError.code !== "PGRST116") {
    throw new StorageError(
      `Error buscando procurement: ${findError.message}`,
      "find",
    );
  }

  const now = nowISO();

  // ── Caso 1: No existe → insertar ──────────────────────────────────────────
  if (!existing) {
    const id = uuidv4();

    // Insertar RAW — columnas según schema: raw_json (no raw_data), source_url y fingerprint son NOT NULL
    const rawFingerprint = createHash("sha256")
      .update(JSON.stringify(normalized.rawJson ?? {}))
      .digest("hex");
    const { data: rawData, error: rawError } = await db
      .from("raw_items")
      .insert({
        source_id: sourceId,
        external_id: normalized.externalId,
        source_url: normalized.sourceUrl || "",
        raw_json: normalized.rawJson,
        fingerprint: rawFingerprint,
        fetched_at: now,
      })
      .select("id")
      .single();

    if (rawError) {
      log.warn({ rawError }, "Error insertando raw_item, continuando...");
    }

    const newRecord: DbProcurement = {
      id,
      source_id: sourceId,
      external_id: normalized.externalId,
      raw_item_id: rawData?.id ?? null,
      expediente_id: normalized.expedienteId,
      licitation_number: normalized.licitationNumber,
      procedure_number: normalized.procedureNumber,
      title: normalized.title,
      description: normalized.description,
      dependency_name: normalized.dependencyName,
      buying_unit: normalized.buyingUnit,
      procedure_type: normalized.procedureType,
      status: normalized.status,
      publication_date: normalized.publicationDate,
      opening_date: normalized.openingDate,
      award_date: normalized.awardDate,
      state: normalized.state,
      municipality: normalized.municipality,
      amount: normalized.amount,
      currency: normalized.currency,
      source_url: normalized.sourceUrl,
      canonical_text: normalized.canonicalText,
      canonical_fingerprint: normalized.canonicalFingerprint,
      lightweight_fingerprint: normalized.lightweightFingerprint,
      last_seen_at: now,
      last_detail_checked_at: now,
      last_attachments_checked_at:
        normalized.attachments.length > 0 ? now : null,
      created_at: now,
      updated_at: now,
    };

    const { error: insertError } = await db
      .from("procurements")
      .insert(newRecord);
    if (insertError) {
      throw new StorageError(
        `Error insertando procurement: ${insertError.message}`,
        "insert",
      );
    }

    // Insertar versión inicial
    await insertProcurementVersion(id, 1, normalized);
    // Insertar adjuntos
    if (normalized.attachments.length > 0) {
      await insertAttachments(id, null, normalized.attachments);
    }

    log.info(
      { externalId: normalized.externalId, title: normalized.title },
      "Nuevo expediente",
    );
    return {
      isNew: true,
      isUpdated: false,
      procurementId: id,
      changedFields: {},
      versionNumber: 1,
    };
  }

  // ── Caso 2: Ya existe, sin cambios ────────────────────────────────────────
  if (existing.canonical_fingerprint === normalized.canonicalFingerprint) {
    await db
      .from("procurements")
      .update({ last_seen_at: now })
      .eq("id", existing.id);

    return {
      isNew: false,
      isUpdated: false,
      procurementId: existing.id,
      changedFields: {},
      versionNumber: 0,
    };
  }

  // ── Caso 3: Ya existe, con cambios ────────────────────────────────────────
  const prevSnapshot: Record<string, unknown> = {
    title: existing.title,
    description: existing.description,
    status: existing.status,
    publication_date: existing.publication_date,
    opening_date: existing.opening_date,
    amount: existing.amount,
    licitation_number: existing.licitation_number,
    source_url: existing.source_url,
  };
  const nextSnapshot: Record<string, unknown> = {
    title: normalized.title,
    description: normalized.description,
    status: normalized.status,
    publication_date: normalized.publicationDate,
    opening_date: normalized.openingDate,
    amount: normalized.amount,
    licitation_number: normalized.licitationNumber,
    source_url: normalized.sourceUrl,
  };
  const changedFields = detectChangedFields(prevSnapshot, nextSnapshot);

  // Actualizar registro principal
  const { error: updateError } = await db
    .from("procurements")
    .update({
      expediente_id: normalized.expedienteId,
      licitation_number: normalized.licitationNumber,
      procedure_number: normalized.procedureNumber,
      title: normalized.title,
      description: normalized.description,
      dependency_name: normalized.dependencyName,
      buying_unit: normalized.buyingUnit,
      procedure_type: normalized.procedureType,
      status: normalized.status,
      publication_date: normalized.publicationDate,
      opening_date: normalized.openingDate,
      award_date: normalized.awardDate,
      state: normalized.state,
      municipality: normalized.municipality,
      amount: normalized.amount,
      currency: normalized.currency,
      source_url: normalized.sourceUrl,
      canonical_text: normalized.canonicalText,
      canonical_fingerprint: normalized.canonicalFingerprint,
      lightweight_fingerprint: normalized.lightweightFingerprint,
      last_seen_at: now,
      last_detail_checked_at: now,
      last_attachments_checked_at:
        normalized.attachments.length > 0 ? now : null,
      updated_at: now,
    })
    .eq("id", existing.id);

  if (updateError) {
    throw new StorageError(
      `Error actualizando procurement: ${updateError.message}`,
      "update",
    );
  }

  // Obtener versión actual
  const { count } = await db
    .from("procurement_versions")
    .select("*", { count: "exact", head: true })
    .eq("procurement_id", existing.id);

  const nextVersion = (count ?? 0) + 1;
  await insertProcurementVersion(
    existing.id,
    nextVersion,
    normalized,
    changedFields,
  );

  log.info(
    {
      externalId: normalized.externalId,
      changedFields: Object.keys(changedFields),
    },
    "Expediente actualizado",
  );

  return {
    isNew: false,
    isUpdated: true,
    procurementId: existing.id,
    changedFields,
    versionNumber: nextVersion,
  };
}

// ─── Versión ─────────────────────────────────────────────────────────────────

async function insertProcurementVersion(
  procurementId: string,
  versionNumber: number,
  normalized: NormalizedProcurement,
  changedFields?: Record<string, { prev: unknown; next: unknown }>,
): Promise<void> {
  const db = getSupabaseClient();
  const version: DbProcurementVersion = {
    id: uuidv4(),
    procurement_id: procurementId,
    version_number: versionNumber,
    status: normalized.status,
    title: normalized.title,
    description: normalized.description,
    publication_date: normalized.publicationDate,
    source_url: normalized.sourceUrl,
    fingerprint: normalized.canonicalFingerprint,
    changed_fields_json: changedFields ?? null,
    raw_snapshot_json: normalized.rawJson as Record<string, unknown>,
    created_at: nowISO(),
  };

  const { error } = await db.from("procurement_versions").insert(version);
  if (error) {
    throw new StorageError(
      `Error insertando versión: ${error.message}`,
      "insert_version",
    );
  }
}

// ─── Adjuntos ─────────────────────────────────────────────────────────────────

async function insertAttachments(
  procurementId: string,
  versionId: string | null,
  attachments: NormalizedProcurement["attachments"],
): Promise<void> {
  const db = getSupabaseClient();
  const now = nowISO();

  const records: DbAttachment[] = attachments.map((att) => ({
    id: uuidv4(),
    procurement_id: procurementId,
    version_id: versionId,
    file_name: att.fileName,
    file_type: att.fileType,
    file_url: att.fileUrl,
    file_hash: att.fileHash,
    detected_text: att.detectedText,
    created_at: now,
  }));

  const { error } = await db.from("attachments").insert(records);
  if (error) {
    log.warn({ error: error.message }, "Error insertando adjuntos");
  }
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function findProcurementById(
  id: string,
): Promise<DbProcurement | null> {
  const { data, error } = await getSupabaseClient()
    .from("procurements")
    .select("*")
    .eq("id", id)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new StorageError(
      `Error buscando procurement: ${error.message}`,
      "find_by_id",
    );
  }
  return data ?? null;
}

export async function searchProcurements(
  query: string,
  limit = 10,
): Promise<DbProcurement[]> {
  const { data, error } = await getSupabaseClient()
    .from("procurements")
    .select("*")
    .or(
      `title.ilike.%${query}%,` +
        `dependency_name.ilike.%${query}%,` +
        `expediente_id.ilike.%${query}%,` +
        `licitation_number.ilike.%${query}%`,
    )
    .order("last_seen_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new StorageError(
      `Error buscando procurements: ${error.message}`,
      "search",
    );
  }
  return data ?? [];
}
