import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { ExternalLeadRunResult } from "../modules/external-opportunity-discovery";

process.env.ENABLE_EXTERNAL_LEADS_OSINT ??= "true";
process.env.EXTERNAL_LEADS_DRY_RUN ??= "true";
process.env.EXTERNAL_LEADS_TELEGRAM_ENABLED ??= "false";
process.env.EXTERNAL_LEADS_DISCOVERY_MODE ??= "true";
process.env.EXTERNAL_LEADS_DEBUG_DISCARDS ??= "true";

const REPORT_PATH = path.resolve(
  process.cwd(),
  "../../docs/reports/external-leads-final-activation.md",
);

function formatList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- ninguno";
}

async function writeActivationReport(
  result: ExternalLeadRunResult,
): Promise<void> {
  const discarded =
    result.skippedLowScore +
    result.skippedMissingSourceUrl +
    result.skippedMissingEvidence +
    result.skippedDuplicateAlert +
    result.discardedByKeyword +
    result.discardedByEvidence +
    result.discardedByDate +
    result.discardedBySanitization +
    result.discardedByScope +
    result.discardedByDeduplication;
  const sourceErrors = result.sourceQueries
    .filter((query) => !query.ok)
    .map(
      (query) =>
        `${query.query} -> ${query.httpStatus ?? "sin status"}${query.error ? ` (${query.error})` : ""}`,
    );
  const runtimeErrors = result.errors.map((error) => `runtime -> ${error}`);
  const recommendation =
    result.status === "success"
      ? "Dry-run validado. Mantener Telegram apagado y revisar errores recuperables de fuente antes de producción."
      : "No activar en producción hasta corregir los errores fatales del dry-run.";

  const report = [
    "# External Leads OSINT - Activacion final controlada",
    "",
    `Fecha: ${new Date().toISOString()}`,
    "",
    "## Resultado del dry-run",
    "",
    `- Status: ${result.status}${result.reason ? ` (${result.reason})` : ""}`,
    `- Dry run: ${result.dryRun}`,
    `- Consultas realizadas: ${result.sourceQueries.length}`,
    `- Fuentes revisadas: ${result.sourcesReviewed}`,
    `- Resultados crudos: ${result.rawResultsReceived}`,
    `- Normalizados: ${result.normalized}`,
    `- Leads detectados: ${result.detected}`,
    `- Leads descartados: ${discarded}`,
    `- Descartados por keyword: ${result.discardedByKeyword}`,
    `- Descartados por evidencia: ${result.discardedByEvidence + result.discardedByMissingEvidence}`,
    `- Descartados por fecha: ${result.discardedByDate}`,
    `- Descartados por sanitización: ${result.discardedBySanitization}`,
    `- Descartados por alcance: ${result.discardedByScope}`,
    `- Descartados por score: ${result.discardedByScore}`,
    `- Descartados por deduplicación: ${result.discardedByDeduplication}`,
    `- Pasarian a guardado: ${result.telegramCandidates}`,
    `- Guardados reales: ${result.saved}`,
    `- Alertas enviadas reales: ${result.alerted}`,
    "",
    "## URLs consultadas",
    "",
    formatList(result.sourceQueries.map((query) => `${query.query} -> ${query.url}`)),
    "",
    "## HTTP status por consulta",
    "",
    formatList(
      result.sourceQueries.map(
        (query) =>
          `${query.query} -> ${query.httpStatus ?? "sin status"}${query.ok ? " OK" : " ERROR"}`,
      ),
    ),
    "",
    "## Errores encontrados",
    "",
    formatList([...sourceErrors, ...runtimeErrors]),
    "",
    "## Top descartados sanitizados",
    "",
    formatList(
      result.topDiscardedCandidates.map((candidate) =>
        `${candidate.title} | ${candidate.sourceName} | score ${candidate.estimatedScore ?? "N/D"} | ${candidate.reasons.join(", ")}${candidate.publicUrl ? ` | ${candidate.publicUrl}` : ""}`,
      ),
    ),
    "",
    "## Recomendacion final",
    "",
    recommendation,
    "",
  ].join("\n");

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, report, "utf8");
}

async function main(): Promise<void> {
  const { resetConfig } = await import("../config/env");
  resetConfig();

  const { runExternalLeadsOsintJob, getExternalLeadRunOptions } = await import(
    "../modules/external-opportunity-discovery"
  );

  const options = {
    ...getExternalLeadRunOptions(),
    enabled: true,
    dryRun: true,
    telegramEnabled: false,
  };

  const result = await runExternalLeadsOsintJob(options);

  const errorsBySource = Object.entries(result.errorsBySource)
    .map(([source, errors]) => `  - ${source}: ${errors.length}`)
    .join("\n") || "  - sin errores por fuente";

  console.log(
    [
      "External Leads OSINT — Dry Run",
      "==============================",
      `Dry run: ${result.dryRun}`,
      `Discovery mode: ${result.discoveryMode}`,
      `Status: ${result.status}${result.reason ? ` (${result.reason})` : ""}`,
      `Fuentes revisadas: ${result.sourcesReviewed}`,
      `Resultados crudos: ${result.rawResultsReceived}`,
      `Normalizados: ${result.normalized}`,
      `Leads detectados: ${result.detected}`,
      `Descartados keyword: ${result.discardedByKeyword}`,
      `Descartados evidencia: ${result.discardedByEvidence + result.discardedByMissingEvidence}`,
      `Descartados fecha: ${result.discardedByDate}`,
      `Descartados sanitización: ${result.discardedBySanitization}`,
      `Descartados alcance: ${result.discardedByScope}`,
      `Descartados por score: ${result.skippedLowScore}`,
      `Descartados sin source_url: ${result.skippedMissingSourceUrl}`,
      `Descartados sin evidence_text: ${result.skippedMissingEvidence}`,
      `Descartados por dedupe: ${result.discardedByDeduplication}`,
      `Candidatos Telegram: ${result.telegramCandidates}`,
      `Guardados: ${result.saved}`,
      `Alertas enviadas: ${result.alerted}`,
      "",
      "Errores por fuente:",
      errorsBySource,
      "",
      result.errors.length > 0
        ? `Errores recientes:\n${result.errors.slice(0, 10).map((err) => `  - ${err}`).join("\n")}`
        : "Errores recientes: ninguno",
    ].join("\n"),
  );

  await writeActivationReport(result);
  console.log(`Reporte generado: ${REPORT_PATH}`);

  if (result.status === "error" && result.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
