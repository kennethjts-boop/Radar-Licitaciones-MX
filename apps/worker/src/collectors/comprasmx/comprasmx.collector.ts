/**
 * COMPRASMX COLLECTOR — Motor incremental de 3 niveles (Fase 2A)
 *
 * MODO 1 — Periodic Incremental Listing Scan:
 *   A. Listing Scan superficial desde COMPRASMX_SEED_URL
 *   B. Comparación de lightweight_fingerprint contra DB
 *   C. Detail Fetch solo si el expediente es nuevo o mutó
 *   D. Attachments solo si hubo Detail Fetch
 *   E. Stop Condition si se alcanza COMPRASMX_STOP_AFTER_KNOWN_STREAK consecutivos idénticos
 *
 * MODO 2 — Daily Direct Recheck:
 *   Toma expedientes activos/en_proceso desde DB y entra directo a source_url
 *   eludiendo por completo el listado general.
 */
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import type { NormalizedProcurement } from "../../types/procurement";
import { BrowserManager } from "./browser.manager";
import {
  ComprasMxNavigator,
  buildListingFingerprint,
  SELECTORS,
} from "./comprasmx.navigator";
import { normalize } from "../../normalizers/procurement.normalizer";
import { getConfig } from "../../config/env";
import { getSupabaseClient } from "../../storage/client";

const log = createModuleLogger("collector-comprasmx");

export const COMPRASMX_SOURCE_KEY = "comprasmx";

export interface ComprasMxCollectorOptions {
  maxPages?: number;
  headless?: boolean;
  timeoutMs?: number;
}

/**
 * Telemetría completa de una corrida del collector.
 */
export interface ComprasMxCollectResult {
  mode: "listing_scan" | "daily_recheck";
  items: NormalizedProcurement[];
  /** Número de páginas de listado escaneadas (solo Modo 1). */
  pagesScanned: number;
  /** Total de filas vistas en el listado (solo Modo 1). */
  totalListingRowsSeen: number;
  /** Expedientes saltados porque el fingerprint coincidió. */
  skippedByFingerprint: number;
  /** Veces que se ejecutó Detail Fetch (nuevo o mutado). */
  detailFetchExecuted: number;
  /** Filas nuevas detectadas (no existían en DB). */
  totalNewDetected: number;
  /** Filas con fingerprint cambiado (existían pero mutaron). */
  totalMutatedDetected: number;
  /** Veces que se revisaron adjuntos (igual a detailFetchExecuted). */
  totalAttachmentsChecked: number;
  /** Racha final de conocidos consecutivos al momento de detención/fin. */
  knownStreak: number;
  /** Razón de parada del scan (streak, maxPages, error, vacío, etc.). */
  stopReason: string | null;
  errors: string[];
  startedAt: string;
  finishedAt: string;
}

// ─── Modo 1: Listing Scan Incremental ────────────────────────────────────────

export async function collectComprasMx(
  options: ComprasMxCollectorOptions = {},
): Promise<ComprasMxCollectResult> {
  const startedAt = nowISO();
  const config = getConfig();
  const baseUrl = config.COMPRASMX_SEED_URL;
  const maxPages = options.maxPages ?? config.COMPRASMX_MAX_LIST_PAGES;
  const MAX_STREAK = config.COMPRASMX_STOP_AFTER_KNOWN_STREAK;

  log.info(
    { mode: "listing_scan", baseUrl, maxPages, maxStreak: MAX_STREAK },
    "🏁 incremental scan started",
  );

  const items: NormalizedProcurement[] = [];
  const errors: string[] = [];
  let pagesScanned = 0;
  let totalListingRowsSeen = 0;
  let skippedByFingerprint = 0;
  let detailFetchExecuted = 0;
  let totalNewDetected = 0;
  let totalMutatedDetected = 0;
  let totalAttachmentsChecked = 0;
  let knownStreak = 0;
  let stopReason: string | null = null;

  try {
    const db = getSupabaseClient();

    const { data: sourceData } = await db
      .from("sources")
      .select("id")
      .eq("key", "comprasmx")
      .single();
    const sourceId = sourceData?.id ?? null;

    await BrowserManager.withContext(async (page, context) => {
      const navigator = new ComprasMxNavigator();

      // ── A. Listing Scan ────────────────────────────────────────────────────
      const { rows: listingRows, pagesScanned: scanned } =
        await navigator.scanListing(page, baseUrl, maxPages);
      pagesScanned = scanned;
      totalListingRowsSeen = listingRows.length;

      if (listingRows.length === 0) {
        stopReason = "listing_empty — no rows extracted from index";
        log.warn({ stopReason }, "No se extrajeron filas del listado.");
        return;
      }

      // ── B–E. Análisis secuencial con Stop Condition ────────────────────────
      for (const row of listingRows) {
        // Calcular fingerprint superficial (determinista, estable)
        const lightweightFingerprint = buildListingFingerprint(row);

        // ── B. Comparar contra DB ──────────────────────────────────────────
        let needsDetail = true;
        let isMutation = false;

        if (sourceId) {
          const { data: existing } = await db
            .from("procurements")
            .select("id, lightweight_fingerprint, source_url")
            .eq("source_id", sourceId)
            .eq("external_id", row.externalId)
            .single();

          if (existing) {
            if (existing.lightweight_fingerprint === lightweightFingerprint) {
              // ── C. Fingerprint coincide → saltar Detail Fetch ───────────
              needsDetail = false;
              knownStreak++;
              log.info(
                { externalId: row.externalId, knownStreak },
                "⏩ skipping detail fetch fingerprint matched",
              );
              skippedByFingerprint++;
            } else {
              // ── C. Fingerprint cambió → sí Detail Fetch ────────────────
              needsDetail = true;
              isMutation = true;
              knownStreak = 0; // Racha se rompe
              log.info(
                { externalId: row.externalId },
                "🔄 detail fetch triggered fingerprint changed",
              );
            }
          } else {
            // ── C. Expediente nuevo → sí Detail Fetch ─────────────────────
            needsDetail = true;
            isMutation = false;
            knownStreak = 0; // Racha se rompe
            log.info(
              { externalId: row.externalId },
              "🆕 detail fetch triggered new record",
            );
          }
        }

        // ── E. Stop Condition ──────────────────────────────────────────────
        if (knownStreak >= MAX_STREAK) {
          stopReason = `stop condition triggered — ${MAX_STREAK} consecutive known records with matching fingerprint`;
          log.info(
            { knownStreak, maxStreak: MAX_STREAK, pagesScanned },
            stopReason,
          );
          break;
        }

        if (!needsDetail) continue;

        // ── C. Detail Fetch (Nivel 2) ──────────────────────────────────────
        detailFetchExecuted++;
        if (isMutation) {
          totalMutatedDetected++;
        } else {
          totalNewDetected++;
        }

        try {
          // Usar la URL de detalle capturada por API interception durante el listing scan.
          // Si no se capturó (sourceUrl vacío), extractDetail usará el fallback de re-navegación.
          // Cada detail fetch usa su propia página nueva — NO se comparte la página del listado.
          const urlToFetch = row.sourceUrl && row.sourceUrl.startsWith('http')
            ? row.sourceUrl
            : row.externalId;

          const rawInput = await navigator.extractDetail(context, urlToFetch);

          if (rawInput) {
            const normalized = normalize(rawInput);
            // Inyectar el fingerprint superficial calculado en listing
            normalized.lightweightFingerprint = lightweightFingerprint;

            // ── D. Adjuntos — solo si hubo Detail Fetch ──────────────────
            if (normalized.attachments.length > 0) {
              totalAttachmentsChecked++;
            }

            items.push(normalized);
          } else {
            errors.push(`No se pudo extraer detalle: ${row.externalId}`);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`Error en ID ${row.externalId}: ${msg}`);
          log.error({ err: e, id: row.externalId }, "❌ Error en detail fetch");
        }
      }

      if (!stopReason) {
        stopReason = `completed — ${pagesScanned} pages scanned, all rows evaluated`;
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, "💥 Falla crítica en BrowserManager");
    errors.push(`BrowserManager crítico: ${msg}`);
    if (!stopReason) stopReason = "critical_error";
  }

  log.info(
    {
      mode: "listing_scan",
      pagesScanned,
      totalListingRowsSeen,
      detailFetchExecuted,
      skippedByFingerprint,
      totalNewDetected,
      totalMutatedDetected,
      totalAttachmentsChecked,
      knownStreak,
      stopReason,
    },
    "✅ Listing scan finalizado",
  );

  return {
    mode: "listing_scan",
    items,
    pagesScanned,
    totalListingRowsSeen,
    skippedByFingerprint,
    detailFetchExecuted,
    totalNewDetected,
    totalMutatedDetected,
    totalAttachmentsChecked,
    knownStreak,
    stopReason,
    errors,
    startedAt,
    finishedAt: nowISO(),
  };
}

// ─── Modo 2: Daily Direct Recheck ─────────────────────────────────────────────

/**
 * Recibe URLs directas de expedientes activos/en_proceso y navega a cada uno sin
 * pasar por el listado general. Elude completamente el índice de búsqueda.
 *
 * @param urls Array de source_url obtenidas de la DB (expedientes activos/en_proceso).
 */
export async function recheckComprasMx(
  urls: string[],
): Promise<ComprasMxCollectResult> {
  const startedAt = nowISO();
  log.info(
    { mode: "daily_recheck", count: urls.length },
    "🏁 daily direct recheck started",
  );

  const items: NormalizedProcurement[] = [];
  const errors: string[] = [];
  let detailFetchExecuted = 0;
  let totalAttachmentsChecked = 0;

  try {
    await BrowserManager.withContext(async (_page, context) => {
      const navigator = new ComprasMxNavigator();
      let count = 0;

      for (const url of urls) {
        count++;
        log.info(
          { mode: "daily_recheck", progress: `${count}/${urls.length}`, url },
          "🔄 direct recheck — navigating to source_url",
        );

        try {
          const rawInput = await navigator.extractDetail(context, url);
          if (rawInput) {
            const normalized = normalize(rawInput);
            detailFetchExecuted++;
            if (normalized.attachments.length > 0) totalAttachmentsChecked++;
            items.push(normalized);
          } else {
            errors.push(`No se pudo re-extraer: ${url}`);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`ReCheck error ${url}: ${msg}`);
          log.error({ err: e, url }, "❌ Error en daily recheck URL");
        }
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(
      { err },
      "💥 Falla crítica en BrowserManager durante Daily Recheck",
    );
    errors.push(`BrowserManager crítico: ${msg}`);
  }

  const stopReason =
    urls.length === 0
      ? "daily_recheck_empty — no active expedientes in DB"
      : `daily direct recheck completed — ${urls.length} URLs revisited`;

  log.info(
    {
      mode: "daily_recheck",
      detailFetchExecuted,
      totalAttachmentsChecked,
      errorsCount: errors.length,
      stopReason,
    },
    "✅ daily direct recheck completed",
  );

  return {
    mode: "daily_recheck",
    items,
    pagesScanned: 0,
    totalListingRowsSeen: 0,
    skippedByFingerprint: 0,
    detailFetchExecuted,
    totalNewDetected: 0,
    totalMutatedDetected: 0,
    totalAttachmentsChecked,
    knownStreak: 0,
    stopReason,
    errors,
    startedAt,
    finishedAt: nowISO(),
  };
}
