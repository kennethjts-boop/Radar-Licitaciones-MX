/**
 * FINANCIAL CEILING ANALYZER — Orquestador principal del módulo.
 *
 * Coordina: fetcher → estimator → reporter
 * Aislado del sistema principal del radar.
 */

import { createModuleLogger } from "../../core/logger";
import {
  FinancialCeilingReport,
  AnalyzedTender,
  SourceConsulted,
} from "./types";
import {
  fetchFromCompranet,
  fetchHistoricalContracts,
  fetchFromPNT,
} from "./fetcher";
import { estimateCeiling } from "./estimator";
import { tokenizeObject, extractYearFromTenderNumber, isFormalTenderNumber } from "./normalizer";
import { saveReports } from "./reporter";

const log = createModuleLogger("financial-ceiling:analyzer");

// ─── Punto de entrada principal ───────────────────────────────────────────────

/**
 * Ejecuta el análisis completo de techo financiero.
 *
 * @param query - Número de licitación o texto libre
 * @returns Reporte completo
 */
export async function analyzeFinancialCeiling(
  query: string,
): Promise<FinancialCeilingReport> {
  const analyzedAt = new Date().toISOString();
  const requestId = Math.random().toString(36).substring(7);
  const startTime = Date.now();
  const errors: string[] = [];
  const sourcesConsulted: SourceConsulted[] = [];

  log.info({ query, requestId }, "🔍 Iniciando análisis de techo financiero");

  // ── 1. Buscar licitación actual ──────────────────────────────────────────────
  let currentContractRaw = null;
  let tenderData: AnalyzedTender = {
    number: query,
    agency: null,
    buyerUnit: null,
    object: null,
    procedure: null,
    publicationDate: null,
    sources: [],
  };

  // CompraNet/ComprasMX
  try {
    const result = await fetchFromCompranet(query);
    sourcesConsulted.push(result.source);

    if (result.data) {
      currentContractRaw = result.data;
      tenderData = {
        number: result.data.numero_licitacion ?? query,
        agency: result.data.dependencia ?? null,
        buyerUnit: result.data.unidad_compradora ?? null,
        object: result.data.objeto_contratacion ?? null,
        procedure: result.data.procedimiento ?? null,
        publicationDate: result.data.fecha_publicacion ?? null,
        sources: [result.source.url],
      };
      log.info({ agency: tenderData.agency, object: tenderData.object?.slice(0, 60) }, "✅ Licitación actual encontrada");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`CompraNet fetch error: ${msg}`);
    log.error({ err, query }, "Error en fetchFromCompranet");
  }

  // PNT como fuente adicional
  if (isFormalTenderNumber(query)) {
    try {
      const pntResult = await fetchFromPNT(query);
      sourcesConsulted.push(pntResult.source);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`PNT fetch error: ${msg}`);
    }
  }

  // ── 2. Construir keywords para búsqueda histórica ────────────────────────────
  const objectForSearch = tenderData.object ?? query;
  const keywords = tokenizeObject(objectForSearch).slice(0, 8);
  const currentYear = extractYearFromTenderNumber(query);

  log.info({ keywords, currentYear }, "🔑 Keywords extraídas para búsqueda histórica");

  // ── 3. Buscar contratos históricos ───────────────────────────────────────────
  let historicalCandidates: typeof currentContractRaw[] = [];

  try {
    const historical = await fetchHistoricalContracts({
      agency: tenderData.agency,
      keywords,
      year: currentYear,
    });
    sourcesConsulted.push(historical.source);
    historicalCandidates = historical.data;
    log.info({ count: historicalCandidates.length }, "📚 Candidatos históricos obtenidos");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Historical fetch error: ${msg}`);
    log.error({ err }, "Error en fetchHistoricalContracts");
  }

  // ── 4. Estimar techo financiero ──────────────────────────────────────────────
  const { ceiling, immediatePrecedent, similarCandidates, warnings } =
    estimateCeiling({
      currentData: currentContractRaw,
      candidates: historicalCandidates.filter(Boolean) as NonNullable<typeof currentContractRaw>[],
      query,
    });

  // ── 5. Construir reporte ─────────────────────────────────────────────────────
  const report: FinancialCeilingReport = {
    query,
    analyzedAt,
    currentTender: tenderData,
    financialCeiling: ceiling,
    immediatePrecedent,
    similarCandidates,
    sourcesConsulted,
    warnings,
    errors,
  };

  // ── 6. Guardar en disco ──────────────────────────────────────────────────────
  try {
    const { jsonPath, mdPath } = await saveReports(report);
    if (jsonPath) log.info({ jsonPath }, "💾 Reporte JSON guardado");
    if (mdPath) log.info({ mdPath }, "💾 Reporte Markdown guardado");
  } catch (err) {
    log.warn({ err }, "No se pudo guardar el reporte en disco");
  }

  const durationMs = Date.now() - startTime;
  const failedSources = sourcesConsulted.filter((s) => s.status === "error" || s.status === "blocked" || s.status === "captcha").length;

  log.info(
    { 
      requestId,
      durationMs,
      confidence: ceiling.confidence, 
      type: ceiling.type, 
      amount: ceiling.amount,
      sourcesCount: sourcesConsulted.length,
      failedSourcesCount: failedSources
    },
    "✅ Análisis completado",
  );

  return report;
}
