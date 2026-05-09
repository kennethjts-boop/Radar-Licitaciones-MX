/**
 * ENRICHMENT REPOSITORY — Persistencia best-effort del pipeline OSINT.
 *
 * Ninguna función debe romper el ciclo de alertas: si la migración no existe
 * todavía o Supabase falla, se registra warning y el enrichment continúa.
 */
import { createModuleLogger } from "../core/logger";
import { getSupabaseClient } from "./client";
import type { DocumentLink } from "../collectors/comprasmx-detail/index";
import type { SipotContract } from "../collectors/pnt-sipot/index";
import type { DownloadResult } from "../services/document-downloader";
import type { ClassifyResult } from "../services/document-classifier";
import type { ExtractedRequirement } from "../services/requirement-extractor";
import type { BudgetSignal } from "../services/budget-signal-extractor";
import type { SimilarProcedure } from "../services/procurement-similarity-engine";
import type { CeilingResult } from "../services/budget-ceiling-engine";
import type { DofPublication } from "../collectors/dof-sidof/index";

const log = createModuleLogger("enrichment-repo");

export interface ParsedEnrichmentDocument {
  link: DocumentLink;
  download: DownloadResult | null;
  classification: ClassifyResult | null;
  parseStatus: string | null;
  text: string;
}

export interface RequirementRecord {
  documentUrl: string | null;
  requirement: ExtractedRequirement;
}

export interface BudgetSignalRecord {
  documentUrl: string | null;
  signal: BudgetSignal;
}

export interface PersistEnrichmentInput {
  jobId: string;
  procurementId: string;
  radarKey: string;
  scope: "MORELOS_ONLY" | "NATIONAL_CAPUFE_DESIERTA";
  status: "success" | "partial_success" | "failed" | "skipped_no_documents";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  documentsFound: number;
  documentsDownloaded: number;
  errors: string[];
  documents: ParsedEnrichmentDocument[];
  requirements: RequirementRecord[];
  budgetSignals: BudgetSignalRecord[];
  similarProcedures: SimilarProcedure[];
  sipotContracts: SipotContract[];
  dofPublications: DofPublication[];
  ceiling: CeilingResult;
}

function chunkText(text: string, maxLen = 1800): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += maxLen) {
    chunks.push(clean.slice(i, i + maxLen));
  }
  return chunks.slice(0, 12);
}

function buildEnrichmentData(input: PersistEnrichmentInput): Record<string, unknown> {
  const sipotAmounts = input.sipotContracts
    .map((c) => c.awardedAmount)
    .filter((amount): amount is number => amount !== null && amount > 0);

  return {
    jobId: input.jobId,
    status: input.status,
    scope: input.scope,
    radarKey: input.radarKey,
    enrichedAt: input.finishedAt,
    documents: input.documents.map((d) => ({
      title: d.link.documentTitle,
      fileUrl: d.link.fileUrl,
      fileType: d.link.fileType,
      downloadStatus: d.download?.downloadStatus ?? "not_downloaded",
      sha256Hash: d.download?.sha256Hash ?? null,
      classification: d.classification,
      parseStatus: d.parseStatus,
    })),
    requirements: input.requirements.map((r) => r.requirement),
    budgetSignals: input.budgetSignals.map((b) => b.signal),
    ceiling: input.ceiling,
    similar: input.similarProcedures,
    sipot: {
      total: input.sipotContracts.length,
      amountMin: sipotAmounts.length > 0 ? Math.min(...sipotAmounts) : null,
      amountMax: sipotAmounts.length > 0 ? Math.max(...sipotAmounts) : null,
      suppliers: Array.from(
        new Set(
          input.sipotContracts
            .map((c) => c.supplier)
            .filter((supplier): supplier is string => supplier !== null && supplier.length > 0),
        ),
      ).slice(0, 10),
      contracts: input.sipotContracts.slice(0, 20).map((c) => ({
        procedureNumber: c.procedureNumber,
        contractNumber: c.contractNumber,
        procurementProcedureNumber: c.procurementProcedureNumber,
        title: c.title,
        dependency: c.dependency,
        supplier: c.supplier,
        supplierRfc: c.supplierRfc,
        awardedAmount: c.awardedAmount,
        amountMin: c.amountMin,
        amountMax: c.amountMax,
        year: c.year,
        signingDate: c.signingDate,
        startDate: c.startDate,
        endDate: c.endDate,
        procedureType: c.procedureType,
        evidenceText: c.evidenceText,
        sourceUrl: c.sourceUrl,
      })),
    },
    dofPublications: input.dofPublications,
  };
}

async function safeStep(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.warn({ err, step: name }, "Persistencia de enrichment omitida");
  }
}

export async function persistEnrichmentResult(input: PersistEnrichmentInput): Promise<void> {
  const db = getSupabaseClient();
  const enrichmentData = buildEnrichmentData(input);
  const documentIdByUrl = new Map<string, string>();

  await safeStep("enrichment_jobs", async () => {
    const { error } = await db.from("enrichment_jobs").upsert({
      id: input.jobId,
      procurement_id: input.procurementId,
      radar_key: input.radarKey,
      scope: input.scope,
      status: input.status,
      documents_found: input.documentsFound,
      documents_downloaded: input.documentsDownloaded,
      errors_json: input.errors,
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      duration_ms: input.durationMs,
    });
    if (error) throw error;
  });

  await safeStep("procurements.enrichment_data", async () => {
    const { error } = await db
      .from("procurements")
      .update({
        scope: input.scope,
        enrichment_data: enrichmentData,
        last_enriched_at: input.finishedAt,
      })
      .eq("id", input.procurementId);
    if (error) throw error;
  });

  await safeStep("procurement_documents", async () => {
    if (input.documents.length === 0) return;
    const rows = input.documents.map((d) => ({
      procurement_id: input.procurementId,
      job_id: input.jobId,
      title: d.link.documentTitle,
      file_name: d.link.fileName,
      file_url: d.link.fileUrl,
      file_type: d.link.fileType,
      document_hint: d.link.documentHint,
      sha256_hash: d.download?.sha256Hash ?? null,
      size_bytes: d.download?.sizeBytes ?? null,
      local_path: d.download?.localPath ?? null,
      download_status: d.download?.downloadStatus ?? "not_downloaded",
      classification_type: d.classification?.documentType ?? null,
      classification_confidence: d.classification?.confidence ?? null,
      parse_status: d.parseStatus,
      text_excerpt: d.text.slice(0, 1000) || null,
      discovered_at: d.link.discoveredAt,
      downloaded_at: d.download?.downloadedAt ?? null,
    }));
    const { data, error } = await db
      .from("procurement_documents")
      .upsert(rows, { onConflict: "procurement_id,file_url" })
      .select("id,file_url");
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ id: string; file_url: string }>) {
      documentIdByUrl.set(row.file_url, row.id);
    }
  });

  await safeStep("document_chunks", async () => {
    const rows = input.documents.flatMap((d) => {
      const documentId = documentIdByUrl.get(d.link.fileUrl);
      if (!documentId) return [];
      return chunkText(d.text).map((chunk, index) => ({
        procurement_document_id: documentId,
        procurement_id: input.procurementId,
        chunk_index: index,
        text: chunk,
      }));
    });
    await db.from("document_chunks").delete().eq("procurement_id", input.procurementId);
    if (rows.length === 0) return;
    const { error } = await db.from("document_chunks").insert(rows);
    if (error) throw error;
  });

  await safeStep("procurement_requirements", async () => {
    await db.from("procurement_requirements").delete().eq("procurement_id", input.procurementId);
    if (input.requirements.length === 0) return;
    const rows = input.requirements.map((r) => ({
      procurement_id: input.procurementId,
      procurement_document_id: r.documentUrl ? documentIdByUrl.get(r.documentUrl) ?? null : null,
      category: r.requirement.category,
      requirement_text: r.requirement.text,
      confidence: r.requirement.confidence,
      matched_keywords_json: r.requirement.matchedKeywords,
      source_excerpt: r.requirement.sourceExcerpt,
    }));
    const { error } = await db.from("procurement_requirements").insert(rows);
    if (error) throw error;
  });

  await safeStep("budget_signals", async () => {
    await db.from("budget_signals").delete().eq("procurement_id", input.procurementId);
    if (input.budgetSignals.length === 0) return;
    const rows = input.budgetSignals.map((b) => ({
      procurement_id: input.procurementId,
      procurement_document_id: b.documentUrl ? documentIdByUrl.get(b.documentUrl) ?? null : null,
      raw_text: b.signal.rawText,
      amount: b.signal.amount,
      confidence: b.signal.confidence,
    }));
    const { error } = await db.from("budget_signals").insert(rows);
    if (error) throw error;
  });

  await safeStep("similar_procedures", async () => {
    await db.from("similar_procedures").delete().eq("procurement_id", input.procurementId);
    if (input.similarProcedures.length === 0) return;
    const rows = input.similarProcedures.map((s) => ({
      procurement_id: input.procurementId,
      source: s.source,
      procedure_id: s.procedureId,
      title: s.title,
      supplier: s.supplier,
      awarded_amount: s.awardedAmount,
      year: s.year,
      similarity_score: s.similarityScore,
      reason: s.reason,
      evidence_url: s.evidenceUrl,
      scope: input.scope,
    }));
    const { error } = await db.from("similar_procedures").insert(rows);
    if (error) throw error;
  });
}
