import { createModuleLogger } from "../core/logger";
import type { PublicTenderDocument } from "../types/procurement";
import { getSupabaseClient } from "./client";

const log = createModuleLogger("tender-documents-repo");

export interface TenderDocumentAuditRecord {
  tenderId: string;
  expediente: string | null;
  licitacionId: string | null;
  document: PublicTenderDocument;
  discardReason?: string | null;
}

export async function persistTenderDocuments(
  records: TenderDocumentAuditRecord[],
): Promise<void> {
  if (records.length === 0) return;

  try {
    const rows = records.map((record) => ({
      tender_id: record.tenderId,
      expediente: record.expediente,
      licitacion_id: record.licitacionId,
      document_name: record.document.documentName,
      document_type: record.document.documentType,
      original_url: record.document.originalUrl,
      public_url: record.document.publicUrl,
      mime_type: record.document.mimeType,
      file_extension: record.document.fileExtension,
      file_size: record.document.fileSize,
      sha256_hash: record.document.sha256Hash,
      detected_at: record.document.detectedAt,
      last_checked_at: record.document.lastCheckedAt,
      is_available: record.document.isAvailable,
      source: record.document.source,
      discard_reason: record.discardReason ?? null,
    }));

    const { error } = await getSupabaseClient()
      .from("tender_documents")
      .upsert(rows, { onConflict: "tender_id,public_url" });

    if (error) throw error;
  } catch (err) {
    log.warn(
      { err, count: records.length },
      "Persistencia de tender_documents omitida",
    );
  }
}
