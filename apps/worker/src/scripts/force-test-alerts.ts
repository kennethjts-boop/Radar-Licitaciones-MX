/**
 * FORCE TEST ALERTS — Diagnóstico y verificación end-to-end del pipeline.
 *
 * Pasos:
 *   1. Consulta procurements en Supabase (CAPUFE / IMSS / CONAVI / HABITAT)
 *   2. Ejecuta el matcher contra radares activos (forzando isNew=true)
 *   3. Si hay matches → envía los primeros 3 a Telegram (bypass seen-filter)
 *   4. Si 0 matches → diagnóstico comparando keywords de radares vs nombres de expedientes
 *
 * Uso:
 *   npx ts-node src/scripts/force-test-alerts.ts
 */
import "dotenv/config";
import { getConfig } from "../config/env";
import { getSupabaseClient } from "../storage/client";
import { getActiveRadars, getRadarByKey } from "../radars/index";
import { evaluateAllRadars } from "../matchers/matcher";
import { enrichMatch } from "../enrichers/match.enricher";
import { sendMatchAlert, sendTelegramMessage } from "../alerts/telegram.alerts";
import type { NormalizedProcurement, ProcurementStatus, ProcedureType } from "../types/procurement";
import type { DbProcurement } from "../types/database";

// ─────────────────────────────────────────────────────────────────────────────

const TARGET_KEYWORDS = ["CAPUFE", "IMSS", "CONAVI", "HABITAT", "ISSSTE"];
const MAX_ALERTS_FORCED = 3;

// ── Helpers ──────────────────────────────────────────────────────────────────

function dbToNormalized(row: DbProcurement): NormalizedProcurement {
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

function banner(title: string): void {
  const line = "─".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(line);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("🚀 force-test-alerts iniciado");

  // Cargar config (crash si falta env var)
  const config = getConfig();
  console.log(`  NODE_ENV: ${config.NODE_ENV}`);
  const db = getSupabaseClient();

  // ── PASO 1: Consultar procurements ──────────────────────────────────────────
  banner("PASO 1 — Consulta Supabase: procurements CAPUFE/IMSS/CONAVI/HABITAT");

  const orFilter = TARGET_KEYWORDS.map(kw =>
    `dependency_name.ilike.%${kw}%,canonical_text.ilike.%${kw}%`
  ).join(",");

  const { data: rows, error } = await db
    .from("procurements")
    .select("*")
    .or(orFilter)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("❌ Error consultando Supabase:", error.message);
    process.exit(1);
  }

  const total = rows?.length ?? 0;
  console.log(`  Registros encontrados: ${total}`);

  if (total === 0) {
    console.log("⚠️  La tabla procurements está vacía o no hay expedientes de estas dependencias.");
    console.log("  → El collector Playwright aún no ha corrido con éxito, o los registros");
    console.log("    tienen dependency_name NULL (API no retornó siglas).");
    process.exit(0);
  }

  // Mostrar 5 ejemplos
  console.log("\n  Primeros 5 ejemplos:");
  const examples = (rows ?? []).slice(0, 5);
  for (const row of examples) {
    console.log(`  ┌ external_id:  ${row.external_id}`);
    console.log(`  │ title:        ${row.title?.slice(0, 80)}`);
    console.log(`  │ dependency:   ${row.dependency_name ?? "(null)"}`);
    console.log(`  │ status:       ${row.status}`);
    console.log(`  │ created_at:   ${row.created_at}`);
    console.log(`  └ source_url:   ${row.source_url?.slice(0, 80)}`);
    console.log();
  }

  // ── PASO 2: Ejecutar matcher ────────────────────────────────────────────────
  banner("PASO 2 — Matcher: evaluar expedientes contra radares activos");

  const radars = getActiveRadars();
  console.log(`  Radares activos: ${radars.length}`);
  for (const r of radars) {
    console.log(`    • [${r.key}] "${r.name}" — includeTerms(${r.includeTerms.length}) minScore=${r.minScore}`);
  }

  interface MatchEntry {
    row: DbProcurement;
    normalized: NormalizedProcurement;
    radarKey: string;
    score: number;
    matchedTerms: string[];
    explanation: string;
    procurementId: string;
  }
  const allMatches: MatchEntry[] = [];

  for (const row of rows ?? []) {
    const normalized = dbToNormalized(row as DbProcurement);
    // isNew=true fuerza la evaluación sin restricción de cambio
    const results = evaluateAllRadars(normalized, radars, true, null);
    for (const r of results) {
      allMatches.push({
        row: row as DbProcurement,
        normalized,
        radarKey: r.radarKey,
        score: r.matchScore,
        matchedTerms: r.matchedTerms,
        explanation: r.explanation,
        procurementId: row.id,
      });
    }
  }

  console.log(`\n  Total matches encontrados: ${allMatches.length}`);

  if (allMatches.length === 0) {
    // ── PASO 3: Diagnóstico si 0 matches ─────────────────────────────────────
    banner("PASO 3 — DIAGNÓSTICO: 0 matches — comparando keywords vs expedientes");

    console.log("\n  ⚠️  Ningún expediente superó el minScore de ningún radar.");
    console.log("\n  Keywords de cada radar vs canonicalText de los primeros 5 expedientes:\n");

    for (const radar of radars) {
      console.log(`  ╔═ ${radar.key} (minScore=${radar.minScore})`);
      console.log(`  ║  includeTerms (${radar.includeTerms.length}): ${radar.includeTerms.slice(0, 8).join(", ")}${radar.includeTerms.length > 8 ? "…" : ""}`);
      for (const ex of examples) {
        const canonical = (ex.canonical_text ?? "").toLowerCase();
        const matched = radar.includeTerms.filter(t => canonical.includes(t.toLowerCase()));
        const ratio = radar.includeTerms.length > 0 ? matched.length / radar.includeTerms.length : 0;
        console.log(`  ║  "${(ex.title ?? "").slice(0, 50)}"…`);
        console.log(`  ║    matched=${matched.length}/${radar.includeTerms.length} (${(ratio * 100).toFixed(0)}%) → score_raw≈${(Math.min(ratio / 0.1, 1) * 0.5).toFixed(2)} minScore=${radar.minScore}`);
        if (matched.length > 0) {
          console.log(`  ║    términos coincidentes: ${matched.slice(0, 5).join(", ")}`);
        }
      }
      console.log("  ╚");
    }

    await sendTelegramMessage(
      [
        "🔬 <b>force-test-alerts: 0 matches en matcher</b>",
        "",
        `📦 Procurements en DB con CAPUFE/IMSS/CONAVI/HABITAT: <b>${total}</b>`,
        `🎯 Radares activos: <b>${radars.length}</b>`,
        "",
        "⚠️ Ningún expediente superó el minScore.",
        "Revisar consola del script para diagnóstico detallado.",
      ].join("\n"),
      "HTML"
    );

    process.exit(0);
  }

  // Mostrar todos los matches
  console.log("\n  Detalle de matches:");
  for (const m of allMatches.slice(0, 15)) {
    console.log(`  • [${m.radarKey}] score=${(m.score * 100).toFixed(0)}% "${(m.row.title ?? "").slice(0, 60)}"…`);
    console.log(`    dep=${m.row.dependency_name ?? "(null)"} status=${m.row.status}`);
    console.log(`    terms: ${m.matchedTerms.slice(0, 5).join(", ")}`);
  }

  // ── PASO 4: Forzar envío a Telegram de los primeros 3 ──────────────────────
  banner(`PASO 4 — Forzar envío Telegram de ${Math.min(MAX_ALERTS_FORCED, allMatches.length)} matches`);

  await sendTelegramMessage(
    [
      "🔬 <b>force-test-alerts: verificando pipeline</b>",
      "",
      `📦 Procurements consultados: <b>${total}</b>`,
      `🎯 Matches totales: <b>${allMatches.length}</b>`,
      `📤 Enviando los primeros <b>${Math.min(MAX_ALERTS_FORCED, allMatches.length)}</b> ahora…`,
    ].join("\n"),
    "HTML"
  );

  let sent = 0;
  for (const m of allMatches.slice(0, MAX_ALERTS_FORCED)) {
    try {
      const matchResult = {
        radarKey: m.radarKey,
        procurementId: m.procurementId,
        matchScore: m.score,
        matchLevel: (m.score >= 0.7 ? "high" : m.score >= 0.4 ? "medium" : "low") as "high" | "medium" | "low",
        matchedTerms: m.matchedTerms,
        excludedTerms: [],
        explanation: m.explanation,
        isNew: true,
        isStatusChange: false,
        previousStatus: null,
      };

      const enriched = await enrichMatch(m.normalized, matchResult);
      const msgId = await sendMatchAlert(enriched);

      if (msgId) {
        sent++;
        console.log(`  ✅ Enviado [${m.radarKey}] msgId=${msgId} — "${(m.row.title ?? "").slice(0, 50)}"`);
      } else {
        console.log(`  ⚠️  sendMatchAlert retornó null para [${m.radarKey}]`);
      }
    } catch (err) {
      console.error(`  ❌ Error enviando [${m.radarKey}]:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Reporte final ───────────────────────────────────────────────────────────
  banner("REPORTE FINAL");
  console.log(`  Procurements consultados:  ${total}`);
  console.log(`  Radares activos:           ${radars.length}`);
  console.log(`  Matches totales:           ${allMatches.length}`);
  console.log(`  Alertas forzadas enviadas: ${sent}/${Math.min(MAX_ALERTS_FORCED, allMatches.length)}`);

  if (sent > 0) {
    console.log("\n  ✅ Pipeline Supabase → Matcher → Telegram: FUNCIONA");
  } else {
    console.log("\n  ❌ Alertas no se enviaron — revisar TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID");
  }

  await sendTelegramMessage(
    [
      "✅ <b>force-test-alerts: COMPLETADO</b>",
      "",
      `📦 Procurements DB: <b>${total}</b>`,
      `🎯 Matches: <b>${allMatches.length}</b>`,
      `📤 Alertas enviadas: <b>${sent}</b>`,
      "",
      sent > 0 ? "✅ Pipeline Supabase → Matcher → Telegram OK" : "❌ Envío fallido — revisar logs",
    ].join("\n"),
    "HTML"
  );

  process.exit(0);
}

main().catch(err => {
  console.error("💥 Error fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
