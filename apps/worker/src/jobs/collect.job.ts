/**
 * COLLECT JOB — Orquesta el ciclo de colección de 30 minutos.
 *
 * Flujo:
 * 1. Adquirir lock
 * 2. iniciar collect_run en DB
 * 3. Ejecutar collector (comprasmx primero)
 * 4. Para cada item: upsert en procurements
 * 5. Evaluar contra radares activos
 * 6. Por cada match: enriquecer y enviar alerta
 * 7. Registrar resultado en collect_run
 * 8. Liberar lock
 */
import { createModuleLogger } from "../core/logger";
import { withLock } from "../core/lock";
import { withTimeout } from "../core/errors";
import { nowISO, formatDuration, isDateExpired, isPublicationTooOld } from "../core/time";
import { healthTracker } from "../core/healthcheck";
import { recordHealthcheck } from "../core/system-state";
import { existsSync, unlinkSync } from "fs";
import { readFile } from "fs/promises";
import {
  collectComprasMx,
  recheckComprasMx,
  COMPRASMX_SOURCE_KEY,
  ComprasMxCollectResult,
} from "../collectors/comprasmx/comprasmx.collector";
import { upsertProcurement } from "../storage/procurement.repo";
import { startCollectRun, finishCollectRun } from "../storage/collect-run.repo";
import {
  createAlert,
  markAlertSent,
  markAlertFailed,
  hasExistingAlert,
  upsertMatch,
} from "../storage/match-alert.repo";
import { getActiveRadars } from "../radars/index";
import { evaluateAllRadars } from "../matchers/matcher";
import { enrichMatch } from "../enrichers/match.enricher";
import { evaluarModalidad, inferTipoContratacion } from "../topes/topes.service";
import {
  sendMatchAlert,
  sendTelegramMessage,
  formatAiVipAlertMessage,
} from "../alerts/telegram.alerts";
import type { ProcurementStatus, NormalizedProcurement, ProcedureType } from "../types/procurement";
import type { DbProcurement } from "../types/database";
import { getSupabaseClient } from "../storage/client";
import { BrowserManager } from "../collectors/comprasmx/browser.manager";
import { ComprasMxNavigator } from "../collectors/comprasmx/comprasmx.navigator";
import { downloadAttachmentsFromDetail } from "../collectors/comprasmx/comprasmx.downloader";
import { uploadAttachment } from "../storage/storage.service";
import { extractTextFromPdf, chunkText } from "../utils/pdf.util";
import { analyzeTenderDocument, generateEmbedding } from "../ai/openai.service";
import { BUSINESS_PROFILE } from "../config/business_profile";
import { sanitizeForKeywordRegex } from "../core/text";
import { sendCapufePeajeDeepReportToTelegram } from "../scripts/capufe-peaje-deep-report";
import { classifyAlert } from '../modules/alert-filter';
import type { CycleMetrics } from '../modules/alert-filter';
import { getConfig } from '../config/env';
import { enrichProcurement } from "./enrich-procurement.job";
import { filterProcurementScope } from "../services/procurement-scope-filter";
import { matchCommercialOpportunity } from "../modules/commercial-matching";
import {
  createCommercialMatchingTelemetry,
  recordCommercialMatchTelemetry,
  type CommercialMatchingTelemetry,
} from "../modules/commercial-matching/telemetry";
import { IMSS_MORELOS_RADAR_KEY } from "../radars/imss-morelos-priority.matcher";

const log = createModuleLogger("collect-job");

const AI_VIP_ALERT_SCORE_THRESHOLD = 70;
const AI_VIP_ALERT_WIN_PROBABILITY_THRESHOLD = 50;
const RAG_MATCH_THRESHOLD = 0.7;
const RAG_MATCH_COUNT = 3;
const MAX_HISTORICAL_CONTEXT_CHARS = 2_000;
const CATEGORY_NONE = "NONE";
const CAPUFE_DEEP_REPORT_TERMS = ["capufe", "peaje", "bolet", "papel term", "rollo term", "caseta"];

// Source ID para comprasmx — resuelto en bootstrap y propagado aquí
let _comprasMxSourceId: string | null = null;

export function setComprasMxSourceId(id: string | null): void {
  _comprasMxSourceId = id;
}

async function recordCurrentHealthcheck(): Promise<void> {
  const status = healthTracker.getStatus();
  await recordHealthcheck({
    healthy: status.overall === "ok",
    worker_status: status.overall,
    db_connected: status.dbConnected,
    db_schema_valid: status.dbSchemaValid,
    telegram_connected: status.services.telegram === "ok",
    runtime_db_mode: status.runtimeDbMode,
  });
}

const COLLECT_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutos
const ATTACHMENT_PIPELINE_TIMEOUT_MS = 3 * 60 * 1000;
const CAPUFE_DEEP_REPORT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_ATTACHMENT_PIPELINES_PER_CYCLE = 5;
const MAX_CAPUFE_DEEP_REPORTS_PER_CYCLE = 2;

export interface CollectJobResult {
  status: "success" | "error" | "skipped";
  reason?: string;
  errorMessage: string | null;
  durationMs: number;
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  totalMatches: number;
  pagesScanned: number;
  stopReason: string | null;
}

function procurementToCommercialInput(item: NormalizedProcurement) {
  return {
    title: item.title,
    description: item.description,
    buyerName: item.dependencyName,
    dependency: item.dependencyName,
    unit: item.buyingUnit,
    procedureId: item.procedureNumber ?? item.licitationNumber ?? item.expedienteId,
    source: item.source,
    sourceUrl: item.sourceUrl,
    publicationDate: item.publicationDate,
    state: item.state,
    municipality: item.municipality,
    placeOfExecution: item.rawJson.placeOfExecution as string | null | undefined,
    placeOfDelivery: item.rawJson.placeOfDelivery as string | null | undefined,
    fullText: item.canonicalText,
    attachmentsText: item.attachments
      .map((attachment) => attachment.detectedText)
      .filter((text): text is string => Boolean(text)),
  };
}

async function processAttachmentsForProcurement(
  procurementId: string,
  sourceUrl: string,
): Promise<string | null> {
  const excludedKeywordsIndex = BUSINESS_PROFILE.EXCLUDED_KEYWORDS.map((word) => ({
    raw: word,
    normalized: sanitizeForKeywordRegex(word),
  }));

  const detectExcludedKeyword = (rawText: string): string | null => {
    const normalizedText = sanitizeForKeywordRegex(rawText);

    for (const keyword of excludedKeywordsIndex) {
      const escaped = keyword.normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(^|\\b)${escaped}(\\b|$)`, "i");
      if (pattern.test(normalizedText)) {
        return keyword.raw;
      }
    }

    return null;
  };

  const db = getSupabaseClient();
  const { data: procurementRow, error: procurementErr } = await db
    .from("procurements")
    .select("licitation_number, source_url")
    .eq("id", procurementId)
    .maybeSingle();

  if (procurementErr) {
    log.warn(
      { err: procurementErr, procurementId },
      "No se pudo cargar metadata de procurement para alertas IA",
    );
  }

  const procurementRef = procurementRow?.licitation_number ?? procurementId;
  const procurementLink = procurementRow?.source_url ?? sourceUrl;

  const { data: existingRows, error: existingErr } = await db
    .from("attachments")
    .select("file_name")
    .eq("procurement_id", procurementId);

  if (existingErr) {
    throw new Error(
      `No se pudieron consultar adjuntos existentes: ${existingErr.message}`,
    );
  }

  const existingFileNames = new Set((existingRows ?? []).map((r) => r.file_name));

  // Capturar fecha_publicacion mientras el browser del detalle está abierto.
  let capturedFechaPublicacion: string | null = null;

  await BrowserManager.withContext(async (page, context) => {
    const navigator = new ComprasMxNavigator();
    const detail = await navigator.extractDetail(context, sourceUrl, page);
    if (!detail) {
      log.warn({ procurementId, sourceUrl }, "No se pudo abrir detalle para adjuntos");
      return;
    }

    // La page está en la URL de detalle — extraer fecha_publicacion del cronograma.
    capturedFechaPublicacion = await navigator.fetchPublicationDate(page);
    if (capturedFechaPublicacion) {
      log.debug(
        { procurementId, sourceUrl, fechaPublicacion: capturedFechaPublicacion },
        "📅 fecha_publicacion extraída del cronograma de detalle",
      );
    }

    const downloads = await downloadAttachmentsFromDetail(page, {
      timeoutMs: 45_000,
    });

    for (const file of downloads) {
      if (existingFileNames.has(file.fileName)) {
        log.info(
          { procurementId, fileName: file.fileName },
          "Archivo ya existe, omitiendo...",
        );
        if (existsSync(file.tempFilePath)) {
          unlinkSync(file.tempFilePath);
        }
        continue;
      }

      try {
        const uploaded = await uploadAttachment(
          procurementId,
          file.fileName,
          file.tempFilePath,
        );

        const { data: insertedAttachment, error: insertErr } = await db
          .from("attachments")
          .insert({
            procurement_id: procurementId,
            file_name: file.fileName,
            storage_path: uploaded.storagePath,
            file_size_bytes: uploaded.fileSizeBytes,
            file_hash: uploaded.fileHash,
            file_url: uploaded.storagePath,
            source_url: sourceUrl,
          })
          .select("id")
          .single();

        if (insertErr) {
          throw new Error(insertErr.message);
        }

        try {
          const rawPdfText = (await readFile(file.tempFilePath)).toString("latin1");
          const excludedKeyword = detectExcludedKeyword(rawPdfText);
          if (excludedKeyword) {
            const skipJustification = `Excluida por keyword bloqueada: ${excludedKeyword}`;
            const { error: skipAnalysisErr } = await db
              .from("document_analysis")
              .upsert({
                attachment_id: insertedAttachment.id,
                score_total: 0,
                score_tech: 0,
                score_commercial: 0,
                score_urgency: 0,
                score_viability: 0,
                contract_type: "No especificado",
                deadline: "No especificado",
                guarantees: "No especificado",
                summary: "Documento descartado por keyword excluida",
                opportunities: [],
                risks: [],
                win_probability: 0,
                competitor_threat_level: "MEDIUM",
                implementation_complexity: "MEDIUM",
                red_flags: [],
                category_detected: CATEGORY_NONE,
                is_relevant: false,
                relevance_justification: skipJustification,
              }, { onConflict: "attachment_id" });

            if (skipAnalysisErr) {
              throw new Error(skipAnalysisErr.message);
            }

            log.info(
              {
                event: "SKIP_EXCLUDED",
                procurementId,
                fileName: file.fileName,
                reason: excludedKeyword,
              },
              "Documento descartado por keyword de exclusión (sin llamada a OpenAI)",
            );

            existingFileNames.add(file.fileName);
            continue;
          }

          const extractedText = await extractTextFromPdf(file.tempFilePath);

          if (!extractedText.trim()) {
            log.warn(
              {
                event: "AI_ANALYSIS_SKIPPED_NO_TEXT",
                procurementId,
                fileName: file.fileName,
              },
              "PDF sin texto legible, requiere OCR",
            );
          } else {
            log.info(
              {
                event: "AI_ANALYSIS_SKIPPED_SAAS",
                procurementId,
                fileName: file.fileName,
              },
              "Análisis automático de IA omitido (ahora se ejecuta on-demand)",
            );
          }
        } catch (pdfErr) {
          log.warn(
            {
              event: "PDF_PROCESSING_FAILED",
              err: pdfErr,
              procurementId,
              fileName: file.fileName,
            },
            "Fallo en procesamiento de PDF del adjunto",
          );
        }

        existingFileNames.add(file.fileName);
      } catch (err) {
        log.warn(
          { err, procurementId, fileName: file.fileName },
          "Error procesando adjunto; continuando con el siguiente",
        );
      } finally {
        if (existsSync(file.tempFilePath)) {
          unlinkSync(file.tempFilePath);
        }
      }
    }
  }, { timeoutMs: ATTACHMENT_PIPELINE_TIMEOUT_MS });

  return capturedFechaPublicacion;
}

export async function runCollectJob(): Promise<CollectJobResult> {
  log.info(
    "Iniciando ciclo de colección — MODO 1: Periodic Incremental Listing Scan",
  );
  const startedAt = nowISO();
  const cycleStart = Date.parse(startedAt);

  const lockResult = await withLock("collect-job", "main-collect", async (): Promise<CollectJobResult> => {
    if (!_comprasMxSourceId) {
      const errorMessage = "No source_id for comprasmx available. Cannot collect.";
      const durationMs = Date.now() - cycleStart;
      log.error(errorMessage);
      healthTracker.recordCycle(durationMs, 0, false);
      await recordCurrentHealthcheck();
      return {
        status: "error",
        errorMessage,
        durationMs,
        itemsSeen: 0,
        itemsCreated: 0,
        itemsUpdated: 0,
        totalMatches: 0,
        pagesScanned: 0,
        stopReason: null,
      };
    }
    const sourceId = _comprasMxSourceId;

    const runId = await startCollectRun(sourceId, COMPRASMX_SOURCE_KEY);
    let itemsSeen = 0;
    let itemsCreated = 0;
    let itemsUpdated = 0;
    let totalMatches = 0;
    let attachmentPipelinesExecuted = 0;
    let capufeDeepReportsAttempted = 0;
    const capufeDeepReportsSent = new Set<string>();
    let alertsSentThisCycle = 0;
    const commercialTelemetry: CommercialMatchingTelemetry =
      createCommercialMatchingTelemetry();
    const cycleMetrics: CycleMetrics = {
      found: 0, alertable: 0, sent: 0, excluded: 0, excludedClosed: 0, excludedOld: 0,
    };
    const config = getConfig();
    const alertFilterOptions = {
      desertaLookbackDays: config.ALERT_DESIERTA_LOOKBACK_DAYS,
      activeMaxAgeDays: config.ALERT_ACTIVE_MAX_AGE_DAYS,
    };
    let errorMessage: string | null = null;
    let collectResult: ComprasMxCollectResult | null = null;
    let durationMs = 0;

    try {
      // 1. Colectar
      collectResult = await withTimeout(
        collectComprasMx({ maxPages: 10, headless: true }),
        COLLECT_TIMEOUT_MS,
        "comprasmx-collection",
      );
      healthTracker.setPlaywrightHealth("ok");

      itemsSeen = collectResult.items.length;
      commercialTelemetry.rawResultsReceived = itemsSeen;
      log.info({ itemsSeen }, "Items colectados");

      const radars = getActiveRadars();

      // Precargar IDs de radar de DB para persistir FK correctamente
      const radarDbIds = new Map<string, string>();
      {
        const { data: radarRows } = await getSupabaseClient()
          .from("radars")
          .select("id, key");
        for (const row of radarRows ?? []) {
          radarDbIds.set(row.key, row.id);
        }
      }

      // 2. Procesar cada item
      for (const item of collectResult.items) {
        try {
          // Upsert en DB
          const upsertResult = await upsertProcurement(item, sourceId);

          if (upsertResult.isNew) itemsCreated++;
          else if (upsertResult.isUpdated) itemsUpdated++;

          // Solo evaluar matches si es nuevo o cambió
          if (!upsertResult.isNew && !upsertResult.isUpdated) continue;

          // ── Filtro Global de Fechas: Solo procesar licitaciones "a partir de hoy" ──
          if (isPublicationTooOld(item.publicationDate)) {
            log.info(
              { externalId: item.externalId, pubDate: item.publicationDate },
              "Licitación omitida por tener una fecha de publicación muy antigua (fuera del margen actual)",
            );
            continue;
          }

          // ── Filtro Global de Ocultamiento Geográfico ──
          const stateLower = (item.state || "").toLowerCase();
          const canonicalGlobalLower = item.canonicalText.toLowerCase();
          const hasExcludedGeo = BUSINESS_PROFILE.EXCLUDED_GEO?.some(geo =>
            stateLower.includes(geo) || canonicalGlobalLower.includes(geo)
          );
          if (hasExcludedGeo) {
            log.info(
              { externalId: item.externalId, state: item.state },
              "Licitación omitida por regla de ocultamiento geográfico (EXCLUDED_GEO)",
            );
            continue;
          }

          // Filtrar licitaciones vencidas: no generar alertas si ya pasó la fecha de apertura.
          // Excepción: las DESIERTA siempre pasan (classifyAlert decidirá si son recientes).
          const isDesiertaItem = item.status.toLowerCase().includes('desierta');
          if (isDateExpired(item.openingDate) && !isDesiertaItem) {
            log.debug(
              { externalId: item.externalId, openingDate: item.openingDate },
              "Licitación con fecha de apertura vencida, omitiendo match",
            );
            continue;
          }

          // Determinar estatus anterior para detectar cambio
          const previousStatus =
            upsertResult.isUpdated && upsertResult.changedFields["status"]
              ? (upsertResult.changedFields["status"].prev as ProcurementStatus)
              : null;

          const commercialInput = procurementToCommercialInput(item);
          const commercialResult = matchCommercialOpportunity(commercialInput, {
            minScore: config.COMMERCIAL_MATCHING_MIN_SCORE,
            requireTerritory: config.COMMERCIAL_MATCHING_REQUIRE_TERRITORY,
            debug: config.COMMERCIAL_MATCHING_DEBUG,
          });
          recordCommercialMatchTelemetry(
            commercialTelemetry,
            commercialInput,
            commercialResult,
          );

          // 3. Match contra radares
          const matches = evaluateAllRadars(
            item,
            radars,
            upsertResult.isNew,
            previousStatus,
          );

          const canonicalLower = item.canonicalText.toLowerCase();
          const dependencyLower = (item.dependencyName ?? "").toLowerCase();
          const isCapufeTender =
            dependencyLower.includes("capufe") &&
            CAPUFE_DEEP_REPORT_TERMS.some((term) => canonicalLower.includes(term));

          let fechaPublicacion: string | null = null;
          const shouldRunAttachmentPipeline = matches.length > 0 || isCapufeTender;
          if (shouldRunAttachmentPipeline) {
            if (attachmentPipelinesExecuted < MAX_ATTACHMENT_PIPELINES_PER_CYCLE) {
              attachmentPipelinesExecuted++;
              try {
                fechaPublicacion = await withTimeout(
                  processAttachmentsForProcurement(
                    upsertResult.procurementId,
                    item.sourceUrl,
                  ),
                  ATTACHMENT_PIPELINE_TIMEOUT_MS + 15_000,
                  `attachments:${item.externalId}`,
                );
              } catch (attErr) {
                log.warn(
                  { err: attErr, externalId: item.externalId },
                  "Fallo en pipeline de adjuntos; se continúa con match/alertas",
                );
              }
            } else {
              log.warn(
                {
                  externalId: item.externalId,
                  maxPerCycle: MAX_ATTACHMENT_PIPELINES_PER_CYCLE,
                },
                "Presupuesto de adjuntos agotado para este ciclo; se continúa sin adjuntos",
              );
            }
          }

          // Inyectar fecha_publicacion en rawJson para que telegram.alerts la muestre.
          if (fechaPublicacion) {
            item.rawJson = { ...item.rawJson, fecha_publicacion: fechaPublicacion };

            if (isPublicationTooOld(fechaPublicacion)) {
              log.info(
                { externalId: item.externalId, pubDate: fechaPublicacion },
                "Licitación omitida por fecha_publicacion antigua extraída del detalle",
              );
              continue;
            }
          }

          if (isCapufeTender && !capufeDeepReportsSent.has(upsertResult.procurementId)) {
            if (capufeDeepReportsAttempted < MAX_CAPUFE_DEEP_REPORTS_PER_CYCLE) {
              capufeDeepReportsAttempted++;
              try {
                const reportSent = await withTimeout(
                  sendCapufePeajeDeepReportToTelegram({
                    procurementId: upsertResult.procurementId,
                    forceProcess: true,
                  }),
                  CAPUFE_DEEP_REPORT_TIMEOUT_MS,
                  `capufe-deep-report:${item.externalId}`,
                );
                if (reportSent) {
                  capufeDeepReportsSent.add(upsertResult.procurementId);
                } else {
                  log.info(
                    { procurementId: upsertResult.procurementId, externalId: item.externalId },
                    "Esperando documentos de CAPUFE...",
                  );
                }
              } catch (deepReportErr) {
                log.warn(
                  {
                    err: deepReportErr,
                    procurementId: upsertResult.procurementId,
                    externalId: item.externalId,
                  },
                  "Falló envío de Reporte Deep CAPUFE a Telegram",
                );
              }
            } else {
              log.warn(
                {
                  externalId: item.externalId,
                  maxPerCycle: MAX_CAPUFE_DEEP_REPORTS_PER_CYCLE,
                },
                "Presupuesto de reportes CAPUFE agotado para este ciclo; se continúa con alertas",
              );
            }
          }

          totalMatches += matches.length;

          // 4. Enriquecer y alertar por cada match
          for (const match of matches) {
            try {
              // ── Filtro geográfico duro ────────────────────────────────────
              // Si el radar tiene geoTerms y el procurement tiene state,
              // verificar que al menos un geoTerm aparezca en state.
              // Excepción: licitaciones DESIERTA siempre pasan (para auditoría).
              const radarCfg = radars.find((r) => r.key === match.radarKey);
              if (
                radarCfg &&
                radarCfg.key !== IMSS_MORELOS_RADAR_KEY &&
                radarCfg.geoTerms.length > 0 &&
                item.state !== null
              ) {
                const stateLower = item.state.toLowerCase();
                const isDesierta = item.status.toLowerCase().includes("desierta");
                const geoMatch = radarCfg.geoTerms.some((t) =>
                  stateLower.includes(t.toLowerCase()),
                );
                if (!geoMatch && !isDesierta) {
                  log.info(
                    {
                      radarKey: match.radarKey,
                      externalId: item.externalId,
                      state: item.state,
                      status: item.status,
                      geoTerms: radarCfg.geoTerms,
                    },
                    "⛔ Alerta omitida — state del procurement no coincide con geoTerms del radar",
                  );
                  continue;
                }
              }

              // ── Filtro de elegibilidad ────────────────────────────────────────────
              cycleMetrics.found++;
              const classification = classifyAlert(item, upsertResult, alertFilterOptions);

              if (classification.decision === 'NOT_ALERTABLE') {
                log.debug(
                  {
                    externalId: item.externalId,
                    status: item.status,
                    normalizedStatus: classification.normalizedStatus,
                    reason: classification.reason,
                  },
                  '[alert-filter] excluded',
                );
                const closedReasons = ['old_closed_status', 'new_but_closed', 'new_but_awarded', 'new_but_cancelled', 'new_but_expired'];
                if (closedReasons.includes(classification.reason)) {
                  cycleMetrics.excludedClosed++;
                } else {
                  cycleMetrics.excludedOld++;
                }
                cycleMetrics.excluded++;
                const _radarDbIdExcluded = radarDbIds.get(match.radarKey);
                const _excludedMatch = { ...match, procurementId: upsertResult.procurementId };
                if (_radarDbIdExcluded) {
                  await upsertMatch(_excludedMatch, _radarDbIdExcluded).catch(() => {});
                }
                continue;
              }

              cycleMetrics.alertable++;

              // Límite duro por ciclo
              if (alertsSentThisCycle >= config.ALERT_MAX_PER_CYCLE) {
                log.warn(
                  { limit: config.ALERT_MAX_PER_CYCLE, externalId: item.externalId },
                  '[alert-filter] límite de ciclo alcanzado, alerta omitida',
                );
                continue;
              }

              // Usar procurement_id real de DB si está disponible
              const enrichableMatch = {
                ...match,
                procurementId: upsertResult.procurementId,
              };

              const radarDbId = radarDbIds.get(match.radarKey);

              // Persistir match en DB antes de alertar
              if (radarDbId) {
                await upsertMatch(enrichableMatch, radarDbId);
              }

              // Evaluar modalidad de contratación si el expediente tiene monto.
              // Se usa el mismo amount como presupuesto_autorizado porque es el único
              // dato financiero disponible en el listing API.
              let modalidadProbable: string | undefined;
              if (item.amount) {
                try {
                  const modalidadResult = await evaluarModalidad({
                    monto: item.amount,
                    tipo: inferTipoContratacion(item),
                    presupuestoAutorizado: item.amount,
                    incluyeIva: false,
                  });
                  modalidadProbable = modalidadResult.modalidad;
                } catch (modalidadErr) {
                  log.warn(
                    { err: modalidadErr, externalId: item.externalId },
                    "No se pudo evaluar modalidad — se omite del mensaje",
                  );
                }
              }

              const enriched = await enrichMatch(item, enrichableMatch, modalidadProbable);
              const alertId = await createAlert(enriched, upsertResult.procurementId, radarDbId);

              const msgId = await sendMatchAlert(enriched);

              if (msgId) {
                alertsSentThisCycle++;
                cycleMetrics.sent++;
                await markAlertSent(alertId, msgId);
              } else {
                await markAlertFailed(alertId);
              }

              // Lanzar enrichment de forma no bloqueante (Fase D)
              const scopeResult = filterProcurementScope({
                state: item.state,
                municipality: item.municipality,
                dependency: item.dependencyName,
                status: item.status,
                canonical_text: item.canonicalText,
              });
              if (scopeResult.allowed) {
                enrichProcurement({
                  procurementId: upsertResult.procurementId,
                  procedureNumber: item.procedureNumber ?? item.licitationNumber,
                  expedienteId: item.expedienteId,
                  sourceUrl: item.sourceUrl,
                  title: item.title,
                  dependency: item.dependencyName,
                  scope: scopeResult.scope as "MORELOS_ONLY" | "NATIONAL_CAPUFE_DESIERTA",
                  radarKey: match.radarKey,
                }).catch((err: unknown) =>
                  log.warn({ err }, "Enrichment falló silenciosamente"),
                );
              }
            } catch (matchErr) {
              log.error(
                {
                  err: matchErr,
                  radarKey: match.radarKey,
                  externalId: item.externalId,
                },
                "Error procesando match",
              );
            }
          }
        } catch (itemErr) {
          log.error(
            { err: itemErr, externalId: item.externalId },
            "Error procesando item",
          );
        }
      }

      // Errores del collector
      if (collectResult.errors.length > 0) {
        errorMessage = collectResult.errors.join("; ");
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      if (!collectResult) {
        healthTracker.setPlaywrightHealth("down");
      }
      log.error({ err }, "Error en ciclo de colección");
      // Notificar a Telegram cuando hay falla crítica del collector
      await sendTelegramMessage(
        `⚠️ ERROR en ciclo de colección: ${(errorMessage ?? "Error desconocido").slice(0, 300)}`,
      ).catch(() => {});
    } finally {
      const finishedAt = nowISO();

      await finishCollectRun(runId, {
        finishedAt,
        status: errorMessage ? "error" : "success",
        itemsSeen,
        itemsCreated,
        itemsUpdated,
        errorMessage: errorMessage || collectResult?.stopReason || null,
        metadata: {
          totalMatches,
          pagesScanned: collectResult?.pagesScanned || 0,
          commercialMatching: commercialTelemetry,
        },
      });

      await (async () => {
        const { setState, STATE_KEYS } = await import("../core/system-state");
        await setState(STATE_KEYS.LAST_COLLECT_RUN, {
          collectorKey: "comprasmx_playwright",
          mode: "listing_scan",
          startedAt,
          startedAtMs: cycleStart,
          finishedAt,
          status: errorMessage ? "error" : "success",
          errorMessage: errorMessage ?? null,
          // Telemetría Fase 2A
          pages_scanned: collectResult?.pagesScanned ?? 0,
          stop_reason: collectResult?.stopReason ?? errorMessage ?? null,
          known_streak: collectResult?.knownStreak ?? 0,
          detail_fetch_executed: collectResult?.detailFetchExecuted ?? 0,
          skipped_by_fingerprint: collectResult?.skippedByFingerprint ?? 0,
          total_listing_rows_seen: collectResult?.totalListingRowsSeen ?? 0,
          total_new_detected: collectResult?.totalNewDetected ?? 0,
          total_mutated_detected: collectResult?.totalMutatedDetected ?? 0,
          total_attachments_checked:
            collectResult?.totalAttachmentsChecked ?? 0,
          itemsSeen,
          itemsCreated,
          itemsUpdated,
          totalMatches,
          alertsSent: alertsSentThisCycle,
          alertMetrics: cycleMetrics,
          commercialMatching: commercialTelemetry,
        });
      })();

      durationMs = Date.now() - cycleStart;
      healthTracker.recordCycle(durationMs, totalMatches, !errorMessage);
      await recordCurrentHealthcheck();

      log.info(cycleMetrics, '[alert-filter] métricas del ciclo');
      if (config.RADAR_DEBUG_CANDIDATES) {
        log.info(
          {
            commercialMatching: {
              totalReviewed: commercialTelemetry.totalReviewed,
              rawResultsReceived: commercialTelemetry.rawResultsReceived,
              recordsWithSufficientText: commercialTelemetry.recordsWithSufficientText,
              discardedByMissingText: commercialTelemetry.discardedByMissingText,
              commercialCandidates: commercialTelemetry.commercialCandidates,
              matchedProfiles: commercialTelemetry.matchedProfiles,
              discardedByNoTerritory: commercialTelemetry.discardedByNoTerritory,
              discardedByKeyword: commercialTelemetry.discardedByKeyword,
              discardedByNegativeKeyword: commercialTelemetry.discardedByNegativeKeyword,
              discardedByLowScore: commercialTelemetry.discardedByLowScore,
              topMatchedCandidates: commercialTelemetry.topMatchedCandidates,
              topDiscardedCandidates: commercialTelemetry.topDiscardedCandidates,
            },
          },
          "RADAR_DEBUG_CANDIDATES commercial matching diagnostics",
        );
      }
      log.info(
        {
          mode: "listing_scan",
          durationMs: formatDuration(durationMs),
          itemsSeen,
          itemsCreated,
          itemsUpdated,
          totalMatches,
          pagesScanned: collectResult?.pagesScanned ?? 0,
          stopReason: collectResult?.stopReason,
          knownStreak: collectResult?.knownStreak ?? 0,
          detailFetchExecuted: collectResult?.detailFetchExecuted ?? 0,
          skippedByFingerprint: collectResult?.skippedByFingerprint ?? 0,
          error: errorMessage,
        },
        "Ciclo Modo 1 (Listing Scan) completado",
      );
    }

    return {
      status: errorMessage ? "error" : "success",
      errorMessage,
      durationMs,
      itemsSeen,
      itemsCreated,
      itemsUpdated,
      totalMatches,
      pagesScanned: collectResult?.pagesScanned ?? 0,
      stopReason: collectResult?.stopReason ?? errorMessage ?? null,
    };
  });

  if (!lockResult) {
    const durationMs = Date.now() - cycleStart;
    return {
      status: "skipped",
      reason: "collect-job lock active",
      errorMessage: null,
      durationMs,
      itemsSeen: 0,
      itemsCreated: 0,
      itemsUpdated: 0,
      totalMatches: 0,
      pagesScanned: 0,
      stopReason: "collect-job lock active",
    };
  }

  return lockResult;
}

// ── Helper: DbProcurement → NormalizedProcurement (Modo 2 DB-only recheck) ──
function dbRowToNormalized(row: DbProcurement): NormalizedProcurement {
  return {
    source: "comprasmx",
    sourceUrl: row.source_url,
    externalId: row.external_id,
    expedienteId: row.expediente_id,
    licitationNumber: row.licitation_number,
    procedureNumber: row.procedure_number,
    title: row.title,
    description: row.description,
    dependencyName: row.dependency_name,
    buyingUnit: row.buying_unit,
    procedureType: (row.procedure_type as ProcedureType) ?? "unknown",
    status: (row.status as ProcurementStatus) ?? "unknown",
    publicationDate: row.publication_date,
    openingDate: row.opening_date,
    awardDate: row.award_date,
    state: row.state,
    municipality: row.municipality,
    amount: row.amount,
    currency: (row.currency as "MXN" | "USD" | null) ?? null,
    attachments: [],
    canonicalText: row.canonical_text,
    canonicalFingerprint: row.canonical_fingerprint,
    lightweightFingerprint: row.lightweight_fingerprint,
    canonicalHash: row.canonical_hash ?? null,
    rawJson: {},
    fetchedAt: row.last_seen_at,
  };
}

/**
 * RE-CHECK JOB (MODO 2) — Escaneo diario puro DB: evalúa TODOS los procurements
 * contra radares activos sin usar Playwright. Envía alertas solo para matches
 * que no hayan sido alertados en las últimas 48h.
 */
export async function runRecheckJob(): Promise<void> {
  log.info("🔄 MODO 2 — DB recheck diario iniciado: evaluando todos los procurements");
  const startedAt = nowISO();
  const cycleStart = Date.parse(startedAt);

  await withLock("recheck-job", "daily-recheck", async () => {
    if (!_comprasMxSourceId) {
      log.error("No source_id for comprasmx disponible. No se puede hacer recheck.");
      return;
    }
    const sourceId = _comprasMxSourceId;
    const runId = await startCollectRun(sourceId, COMPRASMX_SOURCE_KEY + "_recheck");

    let totalSeen = 0;
    let totalMatches = 0;
    let errorMessage: string | null = null;

    try {
      const db = getSupabaseClient();
      const radars = getActiveRadars();

      // Precargar IDs de radar de DB para persistir FK correctamente
      const radarDbIds = new Map<string, string>();
      {
        const { data: radarRows } = await db
          .from("radars")
          .select("id, key");
        for (const row of radarRows ?? []) {
          radarDbIds.set(row.key, row.id);
        }
      }

      // Paginar todos los procurements del source
      const PAGE_SIZE = 100;
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: rows, error } = await db
          .from("procurements")
          .select("*")
          .eq("source_id", sourceId)
          .order("created_at", { ascending: false })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (error) throw new Error(`DB error paginando procurements: ${error.message}`);
        if (!rows || rows.length === 0) { hasMore = false; break; }

        totalSeen += rows.length;
        hasMore = rows.length === PAGE_SIZE;
        log.info({ page, count: rows.length, totalSeen }, "MODO 2 — evaluando página");

        for (const row of rows) {
          try {
            const normalized = dbRowToNormalized(row as DbProcurement);
            const matches = evaluateAllRadars(normalized, radars, false, null);

            for (const match of matches) {
              totalMatches++;
              try {
                const enrichableMatch = { ...match, procurementId: (row as DbProcurement).id };
                const radarDbId = radarDbIds.get(match.radarKey);
                // Modo 2: solo persiste el match para métricas. NO envía alertas a Telegram.
                if (radarDbId) {
                  await upsertMatch(enrichableMatch, radarDbId);
                }
              } catch (err) {
                log.error({ err }, 'Error registrando match en recheck DB');
              }
            }
          } catch (e) {
            log.error({ e, rowId: (row as DbProcurement).id }, "Error evaluando procurement en recheck");
          }
        }

        page++;
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err }, "❌ Error en ciclo recheck DB");
    } finally {
      const finishedAt = nowISO();
      await finishCollectRun(runId, {
        finishedAt,
        status: errorMessage ? "error" : "success",
        itemsSeen: totalSeen,
        itemsCreated: 0,
        itemsUpdated: 0,
        errorMessage,
        metadata: { totalMatches, mode: "daily_recheck_db" },
      });

      const { setState, STATE_KEYS: SK } = await import("../core/system-state");
      await setState(SK.LAST_COLLECT_RUN, {
        collectorKey: "comprasmx_db_recheck",
        mode: "daily_recheck_db",
        startedAt,
        startedAtMs: cycleStart,
        finishedAt,
        status: errorMessage ? "error" : "success",
        errorMessage: errorMessage ?? null,
        pages_scanned: 0,
        stop_reason: `DB recheck completado: ${totalSeen} procurements evaluados`,
        known_streak: 0,
        detail_fetch_executed: 0,
        skipped_by_fingerprint: 0,
        total_listing_rows_seen: totalSeen,
        total_new_detected: 0,
        total_mutated_detected: 0,
        total_attachments_checked: 0,
        itemsSeen: totalSeen,
        itemsCreated: 0,
        itemsUpdated: 0,
      }).catch(() => {});

      const durationMs = Date.now() - cycleStart;
      log.info(
        {
          mode: "daily_recheck_db",
          duration: formatDuration(durationMs),
          totalSeen,
          totalMatches,
          status: errorMessage ? "error" : "success",
        },
        "🏁 MODO 2 — DB recheck completado",
      );
    }
  });
}
