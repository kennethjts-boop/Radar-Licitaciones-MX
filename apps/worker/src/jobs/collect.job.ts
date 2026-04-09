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
import { nowISO, formatDuration } from "../core/time";
import { healthTracker } from "../core/healthcheck";
import { existsSync, unlinkSync } from "fs";
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
} from "../storage/match-alert.repo";
import { getActiveRadars } from "../radars/index";
import { evaluateAllRadars } from "../matchers/matcher";
import { enrichMatch } from "../enrichers/match.enricher";
import { sendMatchAlert } from "../alerts/telegram.alerts";
import type { ProcurementStatus } from "../types/procurement";
import { getSupabaseClient } from "../storage/client";
import { BrowserManager } from "../collectors/comprasmx/browser.manager";
import { ComprasMxNavigator } from "../collectors/comprasmx/comprasmx.navigator";
import { downloadAttachmentsFromDetail } from "../collectors/comprasmx/comprasmx.downloader";
import { uploadAttachment } from "../storage/storage.service";
import { extractTextFromPdf } from "../utils/pdf.util";
import { analyzeTenderDocument } from "../ai/openai.service";
import { sendTelegramMessage } from "../alerts/telegram.alerts";
import { truncateForTelegram } from "../core/text";

const log = createModuleLogger("collect-job");
const AI_VIP_ALERT_SCORE_THRESHOLD = 70;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAiVipAlertMessage(params: {
  score: number;
  procurementTitle: string;
  procurementRef: string;
  fileName: string;
  summary: string;
  opportunities: string[];
  risks: string[];
  link: string;
}): string {
  const opportunities =
    params.opportunities.length > 0
      ? params.opportunities.slice(0, 3).map((item) => `• ${escapeHtml(item)}`)
      : ["• Sin oportunidades explícitas detectadas."];
  const risks =
    params.risks.length > 0
      ? params.risks.slice(0, 3).map((item) => `• ${escapeHtml(item)}`)
      : ["• Sin riesgos explícitos detectados."];

  const lines: string[] = [
    `🚨 <b>ALERTA DE OPORTUNIDAD: ${params.score}/100</b> 🚨`,
    `📄 <b>Licitación:</b> ${escapeHtml(params.procurementTitle)}`,
    `🆔 <b>Referencia:</b> ${escapeHtml(params.procurementRef)}`,
    `📁 <b>Archivo:</b> ${escapeHtml(params.fileName)}`,
    "",
    `📝 <b>Resumen:</b> ${escapeHtml(params.summary || "Sin resumen disponible.")}`,
    "",
    "✅ <b>Oportunidades:</b>",
    ...opportunities,
    "",
    "⚠️ <b>Riesgos:</b>",
    ...risks,
    "",
    `🔗 <b>Link:</b> ${escapeHtml(params.link)}`,
  ];

  return truncateForTelegram(lines.join("\n"));
}

// Source ID para comprasmx — resuelto en bootstrap y propagado aquí
let _comprasMxSourceId: string | null = null;

export function setComprasMxSourceId(id: string | null): void {
  _comprasMxSourceId = id;
}

const COLLECT_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutos

async function processAttachmentsForProcurement(
  procurementId: string,
  sourceUrl: string,
): Promise<void> {
  const db = getSupabaseClient();
  const { data: procurementRow, error: procurementErr } = await db
    .from("procurements")
    .select("title, licitation_number, source_url")
    .eq("id", procurementId)
    .maybeSingle();

  if (procurementErr) {
    log.warn(
      { err: procurementErr, procurementId },
      "No se pudo cargar metadata de procurement para alertas IA",
    );
  }

  const procurementTitle = procurementRow?.title ?? `Procurement ${procurementId}`;
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

  await BrowserManager.withContext(async (page, context) => {
    const navigator = new ComprasMxNavigator();
    const detail = await navigator.extractDetail(context, sourceUrl, page);
    if (!detail) {
      log.warn({ procurementId, sourceUrl }, "No se pudo abrir detalle para adjuntos");
      return;
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
          const extractedText = await extractTextFromPdf(file.tempFilePath);

          if (!extractedText.trim()) {
            log.warn(
              {
                event: "AI_ANALYSIS_SKIPPED_NO_TEXT",
                procurementId,
                fileName: file.fileName,
              },
              "PDF sin texto legible, requiere OCR (Omitiendo IA)",
            );
          } else {
            const analysis = await analyzeTenderDocument(extractedText);

            const { error: analysisInsertErr } = await db
              .from("document_analysis")
              .insert({
                attachment_id: insertedAttachment.id,
                score: analysis.score,
                summary: analysis.summary,
                opportunities: analysis.opportunities,
                risks: analysis.risks,
              });

            if (analysisInsertErr) {
              throw new Error(analysisInsertErr.message);
            }

            if (analysis.score >= AI_VIP_ALERT_SCORE_THRESHOLD) {
              const vipMessage = formatAiVipAlertMessage({
                score: analysis.score,
                procurementTitle,
                procurementRef,
                fileName: file.fileName,
                summary: analysis.summary,
                opportunities: analysis.opportunities,
                risks: analysis.risks,
                link: procurementLink,
              });

              await sendTelegramMessage(vipMessage, "HTML");
              log.info(
                {
                  event: "AI_VIP_ALERT_SENT",
                  score: analysis.score,
                  threshold: AI_VIP_ALERT_SCORE_THRESHOLD,
                  procurementId,
                  fileName: file.fileName,
                },
                "Alerta VIP de IA enviada a Telegram",
              );
            }

            log.info(
              {
                event: "AI_ANALYSIS_COMPLETED",
                score: analysis.score,
                procurementId,
                fileName: file.fileName,
              },
              "Análisis de IA completado para adjunto",
            );
          }
        } catch (aiErr) {
          log.warn(
            {
              event: "AI_ANALYSIS_FAILED",
              err: aiErr,
              procurementId,
              fileName: file.fileName,
            },
            "Fallo en análisis IA del adjunto; continuando pipeline",
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
  });
}

export async function runCollectJob(): Promise<void> {
  log.info(
    "Iniciando ciclo de colección — MODO 1: Periodic Incremental Listing Scan",
  );
  const cycleStart = Date.now();

  await withLock("collect-job", "main-collect", async () => {
    if (!_comprasMxSourceId) {
      log.error("No source_id for comprasmx available. Cannot collect.");
      return;
    }
    const sourceId = _comprasMxSourceId;

    const runId = await startCollectRun(sourceId, COMPRASMX_SOURCE_KEY);
    let itemsSeen = 0;
    let itemsCreated = 0;
    let itemsUpdated = 0;
    let totalMatches = 0;
    let errorMessage: string | null = null;
    let collectResult: ComprasMxCollectResult | null = null;

    try {
      // 1. Colectar
      collectResult = await withTimeout(
        collectComprasMx({ maxPages: 10, headless: true }),
        COLLECT_TIMEOUT_MS,
        "comprasmx-collection",
      );

      itemsSeen = collectResult.items.length;
      log.info({ itemsSeen }, "Items colectados");

      const radars = getActiveRadars();

      // 2. Procesar cada item
      for (const item of collectResult.items) {
        try {
          // Upsert en DB
          const upsertResult = await upsertProcurement(item, sourceId);

          if (upsertResult.isNew) itemsCreated++;
          else if (upsertResult.isUpdated) itemsUpdated++;

          // Solo evaluar matches si es nuevo o cambió
          if (!upsertResult.isNew && !upsertResult.isUpdated) continue;

          try {
            await processAttachmentsForProcurement(
              upsertResult.procurementId,
              item.sourceUrl,
            );
          } catch (attErr) {
            log.warn(
              { err: attErr, externalId: item.externalId },
              "Fallo en pipeline de adjuntos; se continúa con match/alertas",
            );
          }

          // Determinar estatus anterior para detectar cambio
          const previousStatus =
            upsertResult.isUpdated && upsertResult.changedFields["status"]
              ? (upsertResult.changedFields["status"].prev as ProcurementStatus)
              : null;

          // 3. Match contra radares
          const matches = evaluateAllRadars(
            item,
            radars,
            upsertResult.isNew,
            previousStatus,
          );

          totalMatches += matches.length;

          // 4. Enriquecer y alertar por cada match
          for (const match of matches) {
            try {
              // Usar procurement_id real de DB si está disponible
              const enrichableMatch = {
                ...match,
                procurementId: upsertResult.procurementId,
              };

              const enriched = await enrichMatch(item, enrichableMatch);
              const alertId = await createAlert(enriched);

              const msgId = await sendMatchAlert(enriched);

              if (msgId) {
                await markAlertSent(alertId, msgId);
              } else {
                await markAlertFailed(alertId);
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
      log.error({ err }, "Error en ciclo de colección");
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
        },
      });

      await (async () => {
        const { setState, STATE_KEYS } = await import("../core/system-state");
        await setState(STATE_KEYS.LAST_COLLECT_RUN, {
          collectorKey: "comprasmx_playwright",
          mode: "listing_scan",
          startedAt: cycleStart,
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
        });
      })();

      const durationMs = Date.now() - cycleStart;
      healthTracker.recordCycle(durationMs, totalMatches);

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
  });
}

/**
 * RE-CHECK JOB (MODO 2) — Para la iteración de Activos diariamente
 */
export async function runRecheckJob(): Promise<void> {
  log.info(
    "🔄 daily direct recheck started — MODO 2: Daily Direct Recheck de expedientes activos",
  );
  const cycleStart = Date.now();

  await withLock("recheck-job", "daily-recheck", async () => {
    if (!_comprasMxSourceId) {
      log.error("No source_id for comprasmx available. Cannot recheck.");
      return;
    }
    const sourceId = _comprasMxSourceId;
    const runId = await startCollectRun(
      sourceId,
      COMPRASMX_SOURCE_KEY + "_recheck",
    );

    let itemsSeen = 0;
    let itemsCreated = 0;
    let itemsUpdated = 0;
    let totalMatches = 0;
    let errorMessage: string | null = null;

    try {
      const db = (await import("../storage/client")).getSupabaseClient();

      // Obtener expedientes activos o en proceso
      const { data: actives } = await db
        .from("procurements")
        .select("source_url")
        .eq("source_id", sourceId)
        .in("status", [
          "Vigente",
          "activa",
          "en_proceso",
          "Publicado",
          "Por Adjudicar",
        ]);

      if (!actives || actives.length === 0) {
        log.info("No hay expedientes activos para re-checar");
        return;
      }

      const urls = actives.map((a) => a.source_url).filter(Boolean);
      log.info(`Procediendo a re-checar ${urls.length} URLs activas`);

      const collectResult = await recheckComprasMx(urls);
      itemsSeen = collectResult.items.length;

      const radars = getActiveRadars();

      for (const item of collectResult.items) {
        try {
          const upsertResult = await upsertProcurement(item, sourceId);
          if (upsertResult.isNew) itemsCreated++;
          else if (upsertResult.isUpdated) itemsUpdated++;

          if (!upsertResult.isNew && !upsertResult.isUpdated) continue;

          const previousStatus =
            upsertResult.isUpdated && upsertResult.changedFields["status"]
              ? (upsertResult.changedFields["status"].prev as ProcurementStatus)
              : null;

          const matches = evaluateAllRadars(
            item,
            radars,
            upsertResult.isNew,
            previousStatus,
          );
          totalMatches += matches.length;

          for (const match of matches) {
            try {
              const enrichableMatch = {
                ...match,
                procurementId: upsertResult.procurementId,
              };
              const enriched = await enrichMatch(item, enrichableMatch);
              const alertId = await createAlert(enriched);
              const msgId = await sendMatchAlert(enriched);
              if (msgId) await markAlertSent(alertId, msgId);
              else await markAlertFailed(alertId);
            } catch (err) {
              log.error({ err }, "Error procesando match en Recheck");
            }
          }
        } catch (e) {
          log.error(
            { e, url: item.sourceUrl },
            "Error upserting rechecked item",
          );
        }
      }

      if (collectResult.errors.length > 0) {
        errorMessage = collectResult.errors.join("; ");
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err }, "❌ Error en ciclo recheck");
    } finally {
      const finishedAt = nowISO();
      await finishCollectRun(runId, {
        finishedAt,
        status: errorMessage ? "error" : "success",
        itemsSeen,
        itemsCreated,
        itemsUpdated,
        errorMessage,
        metadata: { totalMatches, mode: "daily_recheck" },
      });

      // Guardar telemetría del Modo 2 en system_state
      const { setState, STATE_KEYS: SK } = await import("../core/system-state");
      await setState(SK.LAST_COLLECT_RUN, {
        collectorKey: "comprasmx_playwright",
        mode: "daily_recheck",
        startedAt: cycleStart,
        finishedAt,
        status: errorMessage ? "error" : "success",
        errorMessage: errorMessage ?? null,
        pages_scanned: 0,
        stop_reason: `daily direct recheck completed`,
        known_streak: 0,
        detail_fetch_executed: itemsSeen > 0 ? itemsSeen : 0, // In recheck, itemsSeen is conceptually the fetches
        skipped_by_fingerprint: 0,
        total_listing_rows_seen: 0,
        total_new_detected: itemsCreated,
        total_mutated_detected: itemsUpdated,
        total_attachments_checked: itemsSeen > 0 ? itemsSeen : 0,
        itemsSeen,
        itemsCreated,
        itemsUpdated,
      }).catch(() => {});

      const durationMs = Date.now() - cycleStart;
      log.info(
        {
          mode: "daily_recheck",
          duration: formatDuration(durationMs),
          itemsSeen,
          itemsCreated,
          itemsUpdated,
          totalMatches,
          status: errorMessage ? "error" : "success",
        },
        "🏁 daily direct recheck completed",
      );
    }
  });
}
