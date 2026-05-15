import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { ExternalLeadRunResult } from "../modules/external-opportunity-discovery";

process.env.ENABLE_EXTERNAL_LEADS_OSINT ??= "true";
process.env.EXTERNAL_LEADS_DRY_RUN ??= "true";
process.env.EXTERNAL_LEADS_TELEGRAM_ENABLED ??= "false";

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
    result.skippedDuplicateAlert;
  const sourceErrors = result.sourceQueries
    .filter((query) => !query.ok)
    .map(
      (query) =>
        `${query.query} -> ${query.httpStatus ?? "sin status"}${query.error ? ` (${query.error})` : ""}`,
    );
  const runtimeErrors = result.errors.map((error) => `runtime -> ${error}`);
  const recommendation =
    result.status === "success"
      ? "Listo para activar en Railway con EXTERNAL_LEADS_DRY_RUN=false, manteniendo límites y Telegram controlado."
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
    `- Leads detectados: ${result.detected}`,
    `- Leads descartados: ${discarded}`,
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
      `Status: ${result.status}${result.reason ? ` (${result.reason})` : ""}`,
      `Fuentes revisadas: ${result.sourcesReviewed}`,
      `Leads detectados: ${result.detected}`,
      `Descartados por score: ${result.skippedLowScore}`,
      `Descartados sin source_url: ${result.skippedMissingSourceUrl}`,
      `Descartados sin evidence_text: ${result.skippedMissingEvidence}`,
      `Descartados por duplicado: ${result.skippedDuplicateAlert}`,
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
