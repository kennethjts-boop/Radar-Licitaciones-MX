#!/usr/bin/env ts-node
/**
 * CLI — Análisis de techo financiero por línea de comandos.
 *
 * Uso:
 *   npm run financial:analyze -- --query "LA-050GYR019-E11-2026"
 *   npm run financial:analyze -- --query "mantenimiento vehicular CAPUFE 2026"
 *
 * Corre completamente sin Telegram. Guarda resultados en /data/results/.
 */

import "dotenv/config";
import { analyzeFinancialCeiling } from "../modules/financial-ceiling-radar/analyzer";
import { generateMarkdownReport } from "../modules/financial-ceiling-radar/reporter";

// ─── Parseo de argumentos CLI ─────────────────────────────────────────────────

function parseArgs(): { query: string } {
  const args = process.argv.slice(2);
  const queryIdx = args.findIndex((a) => a === "--query");

  if (queryIdx === -1 || !args[queryIdx + 1]) {
    console.error("❌ Uso: npm run financial:analyze -- --query \"LA-050GYR019-E11-2026\"");
    process.exit(1);
  }

  return { query: args[queryIdx + 1] };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { query } = parseArgs();

  console.log("\n📊 FINANCIAL CEILING RADAR — Análisis CLI");
  console.log("━".repeat(50));
  console.log(`🔎 Query: ${query}`);
  console.log("━".repeat(50));
  console.log("⏳ Consultando fuentes públicas...\n");

  try {
    const report = await analyzeFinancialCeiling(query);

    console.log("✅ RESULTADO:\n");
    console.log(generateMarkdownReport(report));

    console.log("\n" + "━".repeat(50));
    console.log("📊 RESUMEN:");
    console.log(`  Licitación:    ${report.currentTender.number}`);
    console.log(`  Dependencia:   ${report.currentTender.agency ?? "N/D"}`);
    console.log(`  Techo:         ${formatCeil(report)}`);
    console.log(`  Tipo:          ${report.financialCeiling.type}`);
    console.log(`  Confianza:     ${report.financialCeiling.confidence}`);

    if (report.immediatePrecedent) {
      console.log(`  Antecedente:   ${report.immediatePrecedent.tenderNumber ?? "N/D"}`);
      console.log(`  Proveedor:     ${report.immediatePrecedent.supplier ?? "N/D"}`);
      console.log(`  Score:         ${report.immediatePrecedent.similarityScore}/100`);
    }

    if (report.warnings.length) {
      console.log("\n⚠️  ALERTAS:");
      report.warnings.forEach((w) => console.log(`  - ${w}`));
    }

    if (report.errors.length) {
      console.log("\n❌ ERRORES:");
      report.errors.forEach((e) => console.log(`  - ${e}`));
    }

    console.log("\n✅ Análisis completado. Revisa /data/results/ para JSON y Markdown.");
  } catch (err) {
    console.error("❌ Error en análisis:", err);
    process.exit(1);
  }
}

function formatCeil(report: ReturnType<typeof Object.create>): string {
  const fc = report.financialCeiling;
  if (!fc.amount && !fc.rangeMin) return "No determinado";
  if (fc.rangeMin && fc.rangeMax && fc.rangeMin !== fc.amount) {
    return `$${fmt(fc.rangeMin)} — $${fmt(fc.rangeMax)} MXN`;
  }
  return fc.amount ? `$${fmt(fc.amount)} MXN` : "No determinado";
}

function fmt(n: number): string {
  return new Intl.NumberFormat("es-MX").format(n);
}

main();
