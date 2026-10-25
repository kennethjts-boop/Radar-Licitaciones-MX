/**
 * Canal estatal SECOGEM → flujo normal del radar.
 *
 * Cada fila del índice se persiste como procedimientos en `procurements`
 * (fuente secogem_edomex), se evalúa contra los cuatro focos Edomex, se
 * guarda el match versionado y, sólo para filas añadidas después de la línea
 * base, se encola UNA alerta `new_match` por convocatoria en la cola común.
 * La pregunta "¿Vigilar?" se envía tras la entrega (auto-activation).
 */
import axios from "axios";
import { getSupabaseClient } from "../../storage/client";
import { getConfig } from "../../config/env";
import { withDistributedLock } from "../../core/lock";
import { createModuleLogger } from "../../core/logger";
import { isDateExpired } from "../../core/time";
import { upsertProcurement } from "../../storage/procurement.repo";
import { ensurePendingNewTenderAlert, upsertMatch } from "../../storage/match-alert.repo";
import { startCollectRun, finishCollectRun } from "../../storage/collect-run.repo";
import { evaluateAllRadars } from "../../matchers/matcher";
import { enrichMatch } from "../../enrichers/match.enricher";
import { getActiveRadars } from "../../radars/index";
import {
  isEdomexFocusKey,
  isPublishedOnOrAfterEdomexCutoff,
  SECOGEM_SOURCE_KEY,
} from "../../radars/edomex-focus.matcher";
import { parseOfficialPublicationDate } from "../operational-alerts/eligibility";
import { EDOMEX_PAGES, normalizeConvocatoria, pageSlug, parseEdomexPage, type EdomexConvocatoria } from "./policy";
import { runEdomexPdfWatch } from "./consent";
import type { RadarConfig } from "../../types/procurement";

export { handleEdomexCallback, handleEdomexReply, decideEdomexConsent } from "./consent";

const log = createModuleLogger("edomex");

interface PageStats {
  rows: number;
  newRows: number;
  backfilled: number;
  created: number;
  matches: number;
  alertsQueued: number;
  error?: string;
}

export interface EdomexRunSummary {
  at: string;
  deploymentSha: string | null;
  status: "success" | "error" | "skipped";
  pages: Record<string, PageStats>;
  delivered: number;
  watch: { checked: number; changed: number; errors: number } | null;
  errors: string[];
}

async function read<T>(key: string): Promise<T | null> {
  const { data, error } = await getSupabaseClient().from("system_state")
    .select("value_json").eq("key", key).maybeSingle();
  if (error) throw new Error(`Edomex lectura: ${error.message}`);
  return (data?.value_json as T) ?? null;
}
async function write(key: string, value: object): Promise<void> {
  const { error } = await getSupabaseClient().from("system_state")
    .upsert({ key, value_json: value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`Edomex persistencia: ${error.message}`);
}

/** Lectura pública, sin navegador, cookies, IA ni descarga de documentos. */
export async function fetchIndex(url: string): Promise<string> {
  if (!(EDOMEX_PAGES as readonly string[]).includes(url)) throw new Error("Índice no permitido");
  const response = await axios.get<string>(url, { timeout: 25_000, maxRedirects: 0,
    maxContentLength: 5_000_000, responseType: "text" });
  return response.data;
}

interface Context {
  sourceId: string;
  radars: RadarConfig[];
  radarDbIds: Map<string, string>;
}

async function loadContext(): Promise<Context> {
  const db = getSupabaseClient();
  const { data: source, error } = await db.from("sources").select("id").eq("key", SECOGEM_SOURCE_KEY).maybeSingle();
  if (error || !source) throw new Error(`Fuente ${SECOGEM_SOURCE_KEY} ausente; aplicar migración 20261025_edomex_radares`);
  const radars = getActiveRadars().filter((radar) => isEdomexFocusKey(radar.key));
  const { data: rows, error: radarError } = await db.from("radars").select("id,key,is_active")
    .in("key", radars.map((radar) => radar.key));
  if (radarError) throw new Error(`Radares Edomex: ${radarError.message}`);
  const radarDbIds = new Map((rows ?? []).filter((row) => row.is_active).map((row) => [row.key as string, row.id as string]));
  return { sourceId: source.id, radars: radars.filter((radar) => radarDbIds.has(radar.key)), radarDbIds };
}

/**
 * Procedimientos que pertenecen a una fila pendiente. Se fija ANTES de
 * insertar nada: sólo cuenta lo que no existía en BD cuando la fila se vio
 * por primera vez. Así, si un intento inserta y luego falla (match, enrich o
 * cola), el reintento reprocesa esos procedimientos, mientras que históricos
 * o ya procesados por otra fila siguen excluidos.
 */
interface PendingRowClaim {
  owned: string[];
  firstDetectedAt: string;
}
const claimKey = (rowId: string) => `edomex_row_pending:${rowId}`;

async function claimPendingRow(row: EdomexConvocatoria, externalIds: string[], ctx: Context): Promise<PendingRowClaim> {
  const previous = await read<PendingRowClaim>(claimKey(row.rowId));
  if (previous) return previous;
  const { data, error } = await getSupabaseClient().from("procurements").select("external_id")
    .eq("source_id", ctx.sourceId).in("external_id", externalIds);
  if (error) throw new Error(`Edomex procedimientos existentes: ${error.message}`);
  const existing = new Set((data ?? []).map((item) => item.external_id as string));
  const claim = { owned: externalIds.filter((id) => !existing.has(id)), firstDetectedAt: new Date().toISOString() };
  await write(claimKey(row.rowId), claim);
  return claim;
}

/** Procesa una fila añadida tras la línea base. Idempotente; una sola alerta por convocatoria. */
async function processNewRow(row: EdomexConvocatoria, ctx: Context, stats: PageStats): Promise<void> {
  const externalIds = normalizeConvocatoria(row, { firstDetectedAt: "", historical: false }).map((item) => item.externalId);
  const claim = await claimPendingRow(row, externalIds, ctx);
  const owned = new Set(claim.owned);
  let lead: { procurementId: string; item: ReturnType<typeof normalizeConvocatoria>[number];
    match: ReturnType<typeof evaluateAllRadars>[number]; radarDbId: string } | null = null;
  for (const item of normalizeConvocatoria(row, { firstDetectedAt: claim.firstDetectedAt, historical: false })) {
    const upsert = await upsertProcurement(item, ctx.sourceId);
    // Un procedimiento ya conocido antes de esta fila (p.ej. reimpresión del PDF) no es nuevo.
    if (!owned.has(item.externalId)) continue;
    if (upsert.isNew) stats.created++;
    // upsertMatch y la cola (dedupe_key por procedimiento) son idempotentes en reintentos.
    for (const match of evaluateAllRadars(item, ctx.radars, true, null)) {
      const radarDbId = ctx.radarDbIds.get(match.radarKey);
      if (!radarDbId) continue;
      const persisted = { ...match, procurementId: upsert.procurementId };
      await upsertMatch(persisted, radarDbId);
      stats.matches++;
      lead ??= { procurementId: upsert.procurementId, item, match: persisted, radarDbId };
    }
  }
  if (!lead) return;
  const publishedAt = parseOfficialPublicationDate(lead.item.publicationDate);
  if (isDateExpired(lead.item.openingDate) || !isPublishedOnOrAfterEdomexCutoff(publishedAt)) {
    log.info({ procurementId: lead.procurementId, publicationDate: lead.item.publicationDate },
      "Match Edomex persistido sin alerta: vencido o publicado antes de la activación");
    return;
  }
  const enriched = await enrichMatch(lead.item, lead.match, undefined, []);
  const queued = await ensurePendingNewTenderAlert(enriched, lead.procurementId, lead.radarDbId);
  if (queued.created) stats.alertsQueued++;
}

async function processPage(page: string, ctx: Context): Promise<PageStats> {
  const rows = parseEdomexPage(await fetchIndex(page), page);
  const stats: PageStats = { rows: rows.length, newRows: 0, backfilled: 0, created: 0, matches: 0, alertsQueued: 0 };
  const slug = pageSlug(page);
  const baselineKey = `edomex_index:${slug}`;
  const backfillKey = `edomex_backfill_v1:${slug}`;
  const previous = await read<{ ids: string[] }>(baselineKey);
  const known = new Set(previous?.ids ?? []);

  // Archivo histórico: se normaliza sin matches ni alertas, una sola vez.
  // Así un procedimiento histórico que reaparece no se presenta como nuevo.
  if (!(await read(backfillKey))) {
    const historical = previous ? rows.filter((row) => known.has(row.rowId)) : rows;
    const detectedAt = new Date().toISOString();
    for (const row of historical) {
      for (const item of normalizeConvocatoria(row, { firstDetectedAt: detectedAt, historical: true })) {
        const upsert = await upsertProcurement(item, ctx.sourceId);
        if (upsert.isNew) stats.backfilled++;
      }
    }
    await write(backfillKey, { at: detectedAt, rows: historical.length, created: stats.backfilled });
  }

  if (!previous) {
    await write(baselineKey, { ids: rows.map((row) => row.rowId), checkedAt: new Date().toISOString() });
    return stats;
  }
  const processed: string[] = [];
  for (const row of rows.filter((candidate) => !known.has(candidate.rowId))) {
    stats.newRows++;
    try {
      await processNewRow(row, ctx, stats);
      processed.push(row.rowId);
    } catch (err) {
      // Sin avanzar la línea base para esta fila: se reintenta el siguiente ciclo.
      log.warn({ err, rowId: row.rowId, number: row.numberCell }, "Fila Edomex pendiente de reintento");
    }
  }
  await write(baselineKey, { ids: [...new Set([...known, ...processed])], checkedAt: new Date().toISOString() });
  // La línea base ya excluye estas filas; la marca sólo servía para reintentos.
  for (const rowId of processed) {
    const { error } = await getSupabaseClient().from("system_state").delete().eq("key", claimKey(rowId));
    if (error) log.warn({ err: error, rowId }, "Marca de fila Edomex no eliminada; es inocua");
  }
  return stats;
}

/**
 * discover: lee índices, persiste y encola alertas (respeta pausa del colector
 * y watchdog_only desde el scheduler). watch: compara PDFs ya autorizados.
 */
export async function runEdomexJob(options: { discover?: boolean; watch?: boolean } = {}): Promise<EdomexRunSummary | null> {
  return withDistributedLock("edomex", "edomex-indexes", async () => {
    const summary: EdomexRunSummary = {
      at: new Date().toISOString(), deploymentSha: getConfig().RAILWAY_GIT_COMMIT_SHA ?? null, status: "success", pages: {}, delivered: 0, watch: null, errors: [],
    };
    let runId: string | null = null;
    let ctx: Context | null = null;
    if (options.discover !== false) {
      try {
        ctx = await loadContext();
        runId = await startCollectRun(ctx.sourceId, SECOGEM_SOURCE_KEY).catch((err) => {
          log.warn({ err }, "No se pudo registrar collect_run Edomex");
          return null;
        });
        for (const page of EDOMEX_PAGES) {
          try {
            summary.pages[pageSlug(page)] = await processPage(page, ctx);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            summary.errors.push(`${pageSlug(page)}: ${message}`);
            summary.pages[pageSlug(page)] = { rows: 0, newRows: 0, backfilled: 0, created: 0, matches: 0, alertsQueued: 0, error: message };
            log.warn({ err, page }, "Índice Edomex no procesado; se conserva la línea base");
          }
        }
        // Cola común con ComprasMX: mismo límite por ciclo y misma deduplicación.
        const { deliverQueuedNewTenderAlerts } = await import("../../jobs/collect.job");
        summary.delivered = await deliverQueuedNewTenderAlerts(getConfig().ALERT_MAX_PER_CYCLE);
      } catch (err) {
        summary.errors.push(err instanceof Error ? err.message : String(err));
        log.error({ err }, "Ciclo Edomex sin descubrimiento");
      }
    }
    if (options.watch !== false) {
      try { summary.watch = await runEdomexPdfWatch(); } catch (err) {
        summary.errors.push(`watch: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const pages = Object.values(summary.pages);
    if (summary.errors.length > 0) summary.status = "error";
    if (runId) {
      await finishCollectRun(runId, {
        finishedAt: new Date().toISOString(),
        status: summary.errors.length > 0 ? "error" : "success",
        itemsSeen: pages.reduce((total, page) => total + page.rows, 0),
        itemsCreated: pages.reduce((total, page) => total + page.created + page.backfilled, 0),
        itemsUpdated: 0,
        errorMessage: summary.errors.join("; ") || null,
        metadata: summary as unknown as Record<string, unknown>,
      }).catch((err) => log.warn({ err }, "No se pudo cerrar collect_run Edomex"));
    }
    await write("edomex_last_run", summary);
    log.info(summary, "Ciclo Edomex completado");
    return summary;
  });
}
