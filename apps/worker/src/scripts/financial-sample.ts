#!/usr/bin/env ts-node
/**
 * SAMPLE CLI — Prueba con datos simulados (sin llamadas HTTP reales).
 *
 * Uso:
 *   npm run financial:sample
 *
 * Valida:
 * 1. Parsing del número de licitación
 * 2. Normalización de texto
 * 3. Scoring de similitud
 * 4. Estimación de techo
 * 5. Formato Telegram
 * 6. Generación JSON
 * 7. Generación Markdown
 * 8. Guardado en disco
 */

import "dotenv/config";
import { normalizeObjectText, tokenizeObject, textSimilarity, isFormalTenderNumber } from "../modules/financial-ceiling-radar/normalizer";
import { calculateSimilarityScore } from "../modules/financial-ceiling-radar/scorer";
import { estimateCeiling } from "../modules/financial-ceiling-radar/estimator";
import { formatTelegramMessage } from "../modules/financial-ceiling-radar/telegram-formatter";
import { generateJsonReport, generateMarkdownReport, saveReports } from "../modules/financial-ceiling-radar/reporter";
import {
  SAMPLE_CURRENT_TENDER,
  SAMPLE_PRECEDENT,
  SAMPLE_HISTORICAL_CANDIDATES,
  EXPECTED_SAMPLE_RESULT,
} from "../modules/financial-ceiling-radar/sample-data";
import { FinancialCeilingReport } from "../modules/financial-ceiling-radar/types";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ FALLO: ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function fmt(n: number): string {
  return new Intl.NumberFormat("es-MX").format(n);
}

async function main(): Promise<void> {
  console.log("\n📊 FINANCIAL CEILING RADAR — Prueba con datos simulados");
  console.log("━".repeat(60));

  // ── 1. Parsing ───────────────────────────────────────────────────────────────
  console.log("\n📌 1. Parsing de número de licitación");
  check("Detecta número formal LA-xxx", isFormalTenderNumber("LA-050GYR019-E11-2026"));
  check("Detecta número formal IA-xxx", isFormalTenderNumber("IA-917047998-E4-2026"));
  check("Rechaza texto libre", !isFormalTenderNumber("mantenimiento vehicular CAPUFE 2026"));

  // ── 2. Normalización ─────────────────────────────────────────────────────────
  console.log("\n📌 2. Normalización de texto");
  const normalizado = normalizeObjectText("Servicio de Limpieza Integral en Unidades Médicas");
  check("Minúsculas", normalizado === normalizado.toLowerCase());
  check("Sin acentos", !normalizado.includes("é") && !normalizado.includes("á"));
  const tokens = tokenizeObject("Servicio de limpieza integral en unidades médicas del IMSS Morelos");
  check("Tokens significativos", tokens.length > 3, `[${tokens.join(", ")}]`);
  check("Stop words eliminadas", !tokens.includes("de") && !tokens.includes("en"));

  // ── 3. Scoring ───────────────────────────────────────────────────────────────
  console.log("\n📌 3. Scoring de similitud");
  const similarity = textSimilarity(
    "Servicio de limpieza integral en unidades médicas del IMSS Morelos",
    "Servicio de limpieza integral en unidades médicas del IMSS Morelos",
  );
  check("Similitud idéntica = 1.0", similarity === 1.0, `got ${similarity}`);

  const partialSim = textSimilarity(
    "Servicio de limpieza integral IMSS",
    "limpieza hospitales IMSS Morelos",
  );
  check("Similitud parcial > 0.2", partialSim > 0.2, `got ${partialSim.toFixed(3)}`);

  const scoreDetail = calculateSimilarityScore(
    {
      agency: SAMPLE_CURRENT_TENDER.dependencia,
      buyerUnit: SAMPLE_CURRENT_TENDER.unidad_compradora,
      object: SAMPLE_CURRENT_TENDER.objeto_contratacion,
      year: 2026,
    },
    SAMPLE_PRECEDENT,
    2026,
  );
  check(
    `Score >= ${EXPECTED_SAMPLE_RESULT.expectedMinScore}`,
    scoreDetail.total >= EXPECTED_SAMPLE_RESULT.expectedMinScore,
    `got ${scoreDetail.total}`,
  );
  check(
    "Clasificación = antecedente_fuerte",
    scoreDetail.classification === "antecedente_fuerte",
    `got ${scoreDetail.classification}`,
  );

  // ── 4. Estimación de techo ───────────────────────────────────────────────────
  console.log("\n📌 4. Estimación del techo financiero");
  const { ceiling, immediatePrecedent, similarCandidates, warnings } = estimateCeiling({
    currentData: SAMPLE_CURRENT_TENDER,
    candidates: SAMPLE_HISTORICAL_CANDIDATES,
    query: EXPECTED_SAMPLE_RESULT.query,
  });

  check("Confianza MEDIA", ceiling.confidence === "MEDIA", `got ${ceiling.confidence}`);
  check("Tipo = antecedente_inmediato", ceiling.type === "antecedente_inmediato", `got ${ceiling.type}`);
  check("Techo estimado > 0", (ceiling.amount ?? 0) > 0, `got ${ceiling.amount}`);
  check(
    `Dentro del rango esperado ($${fmt(EXPECTED_SAMPLE_RESULT.expectedCeilingMin)}-$${fmt(EXPECTED_SAMPLE_RESULT.expectedCeilingMax)})`,
    ceiling.amount !== null &&
      ceiling.amount >= EXPECTED_SAMPLE_RESULT.expectedCeilingMin &&
      ceiling.amount <= EXPECTED_SAMPLE_RESULT.expectedCeilingMax,
    `got $${fmt(ceiling.amount ?? 0)}`,
  );
  check("Antecedente identificado", immediatePrecedent !== null);
  if (immediatePrecedent) {
    check(
      "Proveedor correcto",
      immediatePrecedent.supplier === EXPECTED_SAMPLE_RESULT.expectedPrecedentSupplier,
      `got ${immediatePrecedent.supplier}`,
    );
    check(
      "Monto anterior correcto",
      immediatePrecedent.amount === EXPECTED_SAMPLE_RESULT.expectedPrecedentAmount,
      `got ${immediatePrecedent.amount}`,
    );
  }
  check("Candidatos similares > 0", similarCandidates.length > 0, `got ${similarCandidates.length}`);

  // ── Construir reporte de muestra ─────────────────────────────────────────────
  const sampleReport: FinancialCeilingReport = {
    query: EXPECTED_SAMPLE_RESULT.query,
    analyzedAt: new Date().toISOString(),
    currentTender: {
      number: SAMPLE_CURRENT_TENDER.numero_licitacion!,
      agency: SAMPLE_CURRENT_TENDER.dependencia ?? null,
      buyerUnit: SAMPLE_CURRENT_TENDER.unidad_compradora ?? null,
      object: SAMPLE_CURRENT_TENDER.objeto_contratacion ?? null,
      procedure: SAMPLE_CURRENT_TENDER.procedimiento ?? null,
      publicationDate: SAMPLE_CURRENT_TENDER.fecha_publicacion ?? null,
      sources: [SAMPLE_CURRENT_TENDER.url_fuente ?? ""],
    },
    financialCeiling: ceiling,
    immediatePrecedent,
    similarCandidates,
    sourcesConsulted: [
      {
        url: "https://comprasmx.buengobierno.gob.mx",
        document: "ComprasMX API Pública (simulado)",
        consultedAt: new Date().toISOString(),
        relevantFragment: "Datos simulados — modo sample",
        status: "ok",
      },
    ],
    warnings,
    errors: [],
  };

  // ── 5. Formato Telegram ──────────────────────────────────────────────────────
  console.log("\n📌 5. Formato Telegram");
  const tgMsg = formatTelegramMessage(sampleReport);
  check("Mensaje generado", tgMsg.length > 50, `len=${tgMsg.length}`);
  check("Contiene encabezado", tgMsg.includes("ANÁLISIS DE TECHO FINANCIERO"));
  check("No excede 4096 chars", tgMsg.length <= 4096, `len=${tgMsg.length}`);
  check("Contiene HTML <b>", tgMsg.includes("<b>"));

  // ── 6. JSON ──────────────────────────────────────────────────────────────────
  console.log("\n📌 6. Generación JSON");
  const json = generateJsonReport(sampleReport);
  let jsonValid = false;
  try { JSON.parse(json); jsonValid = true; } catch { /* noop */ }
  check("JSON válido", jsonValid);
  check("JSON contiene query", json.includes(EXPECTED_SAMPLE_RESULT.query));
  check("JSON contiene financialCeiling", json.includes("financialCeiling"));

  // ── 7. Markdown ──────────────────────────────────────────────────────────────
  console.log("\n📌 7. Generación Markdown");
  const md = generateMarkdownReport(sampleReport);
  check("Markdown generado", md.length > 100);
  check("Contiene H1", md.startsWith("# Análisis financiero"));
  check("Contiene sección techo", md.includes("## Techo financiero"));
  check("Contiene sección antecedente", md.includes("## Antecedente inmediato"));

  // ── 8. Guardado en disco ──────────────────────────────────────────────────────
  console.log("\n📌 8. Guardado en disco (data/results/)");
  try {
    const { jsonPath, mdPath } = await saveReports(sampleReport);
    check("JSON guardado", jsonPath !== null, jsonPath ?? "null");
    check("Markdown guardado", mdPath !== null, mdPath ?? "null");
  } catch (err) {
    check("Guardado en disco", false, String(err));
  }

  // ── Resumen ──────────────────────────────────────────────────────────────────
  console.log("\n" + "━".repeat(60));
  console.log(`📊 RESULTADO: ${passed}/${passed + failed} pruebas pasadas`);
  if (failed > 0) {
    console.log(`❌ ${failed} fallo(s)`);
  } else {
    console.log("✅ Todas las pruebas pasaron");
  }

  console.log("\n📋 MUESTRA MENSAJE TELEGRAM:\n");
  console.log(tgMsg);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ Error inesperado:", err);
  process.exit(1);
});
