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
