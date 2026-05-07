/**
 * ENRICH PROCUREMENT JOB — Orquesta el pipeline de enriquecimiento OSINT.
 *
 * Flujo: D2 (collector Playwright) → D3 (downloader) → D4 (Telegram 2do mensaje)
 * Esta función NUNCA hace throw al caller.
 * Lanzar desde collect.job.ts con .catch() para no bloquear el ciclo principal.
 */
import { v4 as uuidv4 } from "uuid";
import { createModuleLogger } from "../core/logger";
import { nowISO, formatDuration } from "../core/time";
import { collectComprasMxDetail } from "../collectors/comprasmx-detail/index";
import { downloadDocuments } from "../services/document-downloader";
import { sendTelegramMessage, formatEnrichedAlert } from "../alerts/telegram.alerts";
import { parsePdf } from "../parsers/pdf-parser";
import { parseDocx } from "../parsers/docx-parser";
import { parseXlsx } from "../parsers/xlsx-parser";
import { parseZip } from "../parsers/zip-parser";
import { extractBudgetSignals } from "../services/budget-signal-extractor";
import type { BudgetSignalResult } from "../services/budget-signal-extractor";
import { fetchCompranetHistorico } from "../collectors/compranet-historico/index";
import { fetchPntSipot } from "../collectors/pnt-sipot/index";
import { fetchContratacionesAbiertas } from "../collectors/contrataciones-abiertas/index";
import { findSimilarProcurements, type SimilarityResult } from "../services/procurement-similarity-engine";
import { estimateBudgetCeiling, type CeilingResult } from "../services/budget-ceiling-engine";

const log = createModuleLogger("enrich-procurement-job");

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface EnrichmentInput {
  procurementId: string;
  procedureNumber: string | null;
  expedienteId: string | null;
  sourceUrl: string | null;
  title: string | null;
  dependency: string | null;
  scope: "MORELOS_ONLY" | "NATIONAL_CAPUFE_DESIERTA";
  radarKey: string;
}

export interface EnrichmentResult {
  jobId: string;
  procurementId: string;
  status: "success" | "partial_success" | "failed" | "skipped_no_documents";
  documentsFound: number;
  documentsDownloaded: number;
  errors: string[];
  enrichedAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "para", "con", "los", "las", "del", "que", "por", "una", "sus",
  "este", "esta", "como", "todo", "todos", "pero", "sino", "desde",
]);

function extractKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-záéíóúüñ\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
    .slice(0, 5);
}

async function parseDocumentFile(localPath: string, fileType: string): Promise<string> {
  if (fileType === "pdf") return (await parsePdf(localPath)).text;
  if (fileType === "docx") return (await parseDocx(localPath)).text;
  if (fileType === "xlsx") return (await parseXlsx(localPath)).text;
  if (fileType === "zip") {
    const r = await parseZip(localPath);
    return r.files
      .filter((f) => f.parseResult !== null)
      .map((f) => f.parseResult!.text)
      .join("\n");
  }
  return "";
}

// ── Función principal ──────────────────────────────────────────────────────────

export async function enrichProcurement(
  input: EnrichmentInput,
): Promise<EnrichmentResult> {
  const jobId = uuidv4();
  const startedAt = Date.now();
  const errors: string[] = [];

  log.info(
    {
      jobId,
      procurementId: input.procurementId,
      procedureNumber: input.procedureNumber,
      expedienteId: input.expedienteId,
      title: input.title,
      dependency: input.dependency,
      scope: input.scope,
      radarKey: input.radarKey,
      sourceUrl: input.sourceUrl,
    },
    "🔍 enrichProcurement iniciado",
  );

  const base: EnrichmentResult = {
    jobId,
    procurementId: input.procurementId,
    status: "skipped_no_documents",
    documentsFound: 0,
    documentsDownloaded: 0,
    errors,
    enrichedAt: nowISO(),
  };

  // 1. sourceUrl requerido
  if (!input.sourceUrl) {
    log.info({ jobId }, "⏩ skipped — sourceUrl nulo");
    return base;
  }

  try {
    // 2. Detail collector (D2)
    const collectResult = await collectComprasMxDetail({
      sourceUrl: input.sourceUrl,
      procedureNumber: input.procedureNumber,
      expedienteId: input.expedienteId,
      scope: input.scope,
    });

    const documents = collectResult.documents;
    errors.push(...collectResult.errors);

    log.info(
      { jobId, documentsFound: documents.length, collectorStatus: collectResult.collectorStatus },
      "📄 Detail collector completado",
    );

    // 3. Sin documentos → skipped
    if (documents.length === 0) {
      log.info(
        { jobId, durationMs: formatDuration(Date.now() - startedAt) },
        "⏩ skipped — sin documentos",
      );
      return { ...base, status: "skipped_no_documents", errors };
    }

    // 4. Descargar (D3)
    const downloadable = documents.filter((d) => d.isDownloadable);
    const downloadResults = await downloadDocuments(downloadable);

    const succeeded = downloadResults.filter(
      (r) => r.downloadStatus === "ok" || r.downloadStatus === "skipped_duplicate",
    );

    downloadResults
      .filter((r) => r.downloadStatus === "failed" || r.downloadStatus === "too_large")
      .forEach((r) => { if (r.errorMessage) errors.push(r.errorMessage); });

    // 5. Status final
    let status: EnrichmentResult["status"];
    if (succeeded.length === downloadable.length) {
      status = "success";
    } else if (succeeded.length > 0) {
      status = "partial_success";
    } else {
      status = "failed";
    }

    // 5b. Parsear documentos y extraer señal de presupuesto
    const allTexts: string[] = [];
    for (let i = 0; i < downloadable.length; i++) {
      const dlResult = downloadResults[i];
      if (
        (dlResult.downloadStatus === "ok" || dlResult.downloadStatus === "skipped_duplicate") &&
        dlResult.localPath
      ) {
        try {
          const text = await parseDocumentFile(dlResult.localPath, dlResult.fileType);
          if (text) allTexts.push(text);
        } catch (parseErr) {
          log.warn({ err: parseErr, localPath: dlResult.localPath }, "⚠️ Error parseando documento");
        }
      }
    }
    const budgetSignal: BudgetSignalResult = extractBudgetSignals(allTexts.join("\n\n"));

    // 5c. Antecedentes en paralelo (Promise.allSettled — falla silenciosamente)
    const titleKeywords = extractKeywords(input.title ?? "");
    const [historicoSettled, sipotSettled, ocdsSettled] = await Promise.allSettled([
      fetchCompranetHistorico({ keywords: titleKeywords, scope: input.scope, yearFrom: 2020 }),
      fetchPntSipot({ keywords: titleKeywords, scope: input.scope }),
      fetchContratacionesAbiertas({ keywords: titleKeywords, scope: input.scope }),
    ]);

    const historicoContracts =
      historicoSettled.status === "fulfilled" ? historicoSettled.value.contracts : [];
    const sipotContracts =
      sipotSettled.status === "fulfilled" ? sipotSettled.value.contracts : [];
    const ocdsContracts =
      ocdsSettled.status === "fulfilled" ? ocdsSettled.value.contracts : [];

    const compranetAmounts = historicoContracts
      .map((c) => c.awardedAmount ?? 0)
      .filter((a) => a > 0);
    const compranetHighestAmount = compranetAmounts.length > 0
      ? Math.max(...compranetAmounts)
      : null;

    const antecedentes = {
      compranetCount: historicoContracts.length,
      compranetHighestAmount,
      sipotCount: sipotContracts.length,
      ocdsCount: ocdsContracts.length,
    };

    log.info(
      { jobId, compranetCount: antecedentes.compranetCount, sipotCount: antecedentes.sipotCount,
        ocdsCount: antecedentes.ocdsCount },
      "📊 Antecedentes encontrados",
    );

    // 5d. Similitud contractual (G1) — falla silenciosamente
    let similarityResult: SimilarityResult = {
      similarProcedures: [],
      totalFound: 0,
      scopeApplied: input.scope,
    };
    try {
      similarityResult = findSimilarProcurements({
        title: input.title,
        dependency: input.dependency,
        state: null,
        contractType: null,
        keywords: titleKeywords,
        scope: input.scope,
        historico: historicoContracts,
        sipot: sipotContracts,
        ocds: ocdsContracts,
      });
      log.info(
        { jobId, totalSimilares: similarityResult.totalFound },
        "🔗 Contratos similares encontrados",
      );
    } catch (simErr) {
      log.warn({ err: simErr, jobId }, "⚠️ Similarity engine no disponible");
    }

    // 5e. Estimación de techo presupuestal (G2) — falla silenciosamente
    let ceilingResult: CeilingResult = {
      directCeiling: null,
      estimatedMin: null,
      estimatedMax: null,
      average: null,
      median: null,
      confidence: "baja",
      evidence: [],
      explanation: "Sin estimación disponible.",
      legalWarning:
        "Estimación basada únicamente en información pública. No representa monto oficial salvo que el documento lo indique expresamente.",
    };
    try {
      ceilingResult = estimateBudgetCeiling({
        directCeilingFound: budgetSignal.hasSignals,
        directCeilingAmount: budgetSignal.highestAmount,
        budgetSignals: budgetSignal.signals,
        similarProcedures: similarityResult.similarProcedures,
        title: input.title,
        dependency: input.dependency,
      });
    } catch (ceilErr) {
      log.warn({ err: ceilErr, jobId }, "⚠️ Ceiling engine no disponible");
    }

    log.info(
      {
        jobId,
        status,
        documentsFound: documents.length,
        documentsDownloaded: succeeded.length,
        durationMs: formatDuration(Date.now() - startedAt),
      },
      "✅ enrichProcurement completado",
    );

    // 6. Segundo mensaje Telegram (D4) — fire and forget
    const enrichedMessage = formatEnrichedAlert({
      procedureNumber: input.procedureNumber ?? "N/D",
      expedienteId: input.expedienteId,
      title: input.title,
      dependency: input.dependency,
      scope: input.scope,
      documentsFound: documents,
      documentsDownloaded: downloadResults,
      errors,
      budgetSignal: { hasSignals: budgetSignal.hasSignals, highestAmount: budgetSignal.highestAmount },
      antecedentes,
      ceilingEstimate: ceilingResult,
      similarContracts: similarityResult.similarProcedures.slice(0, 3),
    });

    sendTelegramMessage(enrichedMessage, "HTML").catch((err: unknown) => {
      log.warn({ err, jobId }, "⚠️ No se pudo enviar mensaje enriquecido a Telegram");
    });

    return {
      ...base,
      status,
      documentsFound: documents.length,
      documentsDownloaded: succeeded.length,
      errors,
      enrichedAt: nowISO(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, jobId }, "💥 enrichProcurement error crítico");
    errors.push(msg);
    return { ...base, status: "failed", errors, enrichedAt: nowISO() };
  }
}
