/**
 * REPORT GENERATOR — Genera salidas JSON y Markdown del análisis.
 *
 * Guarda en /data/results/ del worker (si existe) y retorna strings.
 */

import fs from "fs/promises";
import path from "path";
import { FinancialCeilingReport, SimilarCandidate } from "./types";
import { createModuleLogger } from "../../core/logger";

const log = createModuleLogger("financial-ceiling:reporter");

// Directorio de resultados relativo al proceso
const RESULTS_DIR = path.resolve(process.cwd(), "data", "results");

// ─── JSON ─────────────────────────────────────────────────────────────────────

export function generateJsonReport(report: FinancialCeilingReport): string {
  return JSON.stringify(report, null, 2);
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

export function generateMarkdownReport(report: FinancialCeilingReport): string {
  const { currentTender: t, financialCeiling: fc, immediatePrecedent: ip, similarCandidates: sc } = report;

  const amountStr = fc.amount
    ? fmtCurrency(fc.amount, fc.currency)
    : "No determinado";

  const rangeStr =
    fc.rangeMin && fc.rangeMax
      ? `${fmtCurrency(fc.rangeMin, fc.currency)} — ${fmtCurrency(fc.rangeMax, fc.currency)}`
      : amountStr;

  const variacion =
    ip?.amount && fc.amount
      ? calcVariacion(ip.amount, fc.amount)
      : "N/D";

  const lines: string[] = [
    "# Análisis financiero de licitación",
    "",
    "## Consulta",
    `- **Búsqueda:** ${report.query}`,
    `- **Fecha de análisis:** ${formatDate(report.analyzedAt)}`,
    "",
    "## Licitación analizada",
    `- **Número:** ${t.number}`,
    `- **Dependencia:** ${t.agency ?? "No identificada"}`,
    `- **Unidad compradora:** ${t.buyerUnit ?? "N/D"}`,
    `- **Objeto:** ${t.object ?? "N/D"}`,
    `- **Procedimiento:** ${t.procedure ?? "N/D"}`,
    `- **Fecha publicación:** ${t.publicationDate ?? "N/D"}`,
    "",
    "## Techo financiero encontrado o estimado",
    `- **Resultado:** ${rangeStr}`,
    `- **Tipo de dato:** ${humanizeCeilingType(fc.type)}`,
    `- **Nivel de confianza:** ${fc.confidence}`,
    `- **Evidencia textual:** ${fc.evidence}`,
    `- **Fuente:** ${t.sources[0] ?? "Ver fuentes consultadas"}`,
    "",
    "## Antecedente inmediato",
    ip
      ? [
          `- **Contrato anterior:** ${ip.tenderNumber ?? ip.contractNumber ?? "N/D"}`,
          `- **Dependencia:** ${ip.agency ?? "N/D"}`,
          `- **Proveedor:** ${ip.supplier ?? "N/D"}`,
          `- **Monto:** ${ip.amount ? fmtCurrency(ip.amount, ip.currency) : "N/D"}`,
          `- **Fecha:** ${ip.date ?? "N/D"}`,
          `- **Similitud:** ${ip.similarityScore}/100`,
          `- **Fuente:** ${ip.sourceUrl ?? "N/D"}`,
        ].join("\n")
      : "- No se identificó antecedente inmediato.",
    "",
    "## Comparativo financiero",
    `- **Monto anterior:** ${ip?.amount ? fmtCurrency(ip.amount, ip.currency) : "N/D"}`,
    `- **Monto actual estimado:** ${rangeStr}`,
    `- **Variación:** ${variacion}`,
    `- **Observaciones:** ${report.warnings.join(" | ") || "Ninguna"}`,
    "",
    "## Otros candidatos similares",
    buildCandidatesTable(sc),
    "",
    "## Riesgos y alertas",
    ...buildWarnings(report),
    "",
    "## Fuentes públicas consultadas",
    ...report.sourcesConsulted.map((s) =>
      `- **${s.document}** | [${s.url.slice(0, 80)}](${s.url}) | ${formatDate(s.consultedAt)} | ${s.relevantFragment ?? s.status}`,
    ),
  ];

  return lines.join("\n");
}

// ─── Persistencia ─────────────────────────────────────────────────────────────

export async function saveReports(
  report: FinancialCeilingReport,
): Promise<{ jsonPath: string | null; mdPath: string | null }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const baseName = `financial-ceiling-${timestamp}`;

  let jsonPath: string | null = null;
  let mdPath: string | null = null;

  try {
    await fs.mkdir(RESULTS_DIR, { recursive: true });

    jsonPath = path.join(RESULTS_DIR, `${baseName}.json`);
    await fs.writeFile(jsonPath, generateJsonReport(report), "utf-8");
    log.info({ jsonPath }, "JSON report guardado");

    mdPath = path.join(RESULTS_DIR, `${baseName}.md`);
    await fs.writeFile(mdPath, generateMarkdownReport(report), "utf-8");
    log.info({ mdPath }, "Markdown report guardado");
  } catch (err) {
    log.warn({ err }, "No se pudieron guardar los reportes en disco");
  }

  return { jsonPath, mdPath };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(amount: number, currency: "MXN" | "USD"): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-MX", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Mexico_City",
    });
  } catch {
    return iso;
  }
}

function calcVariacion(prev: number, curr: number): string {
  if (prev === 0) return "N/D";
  const pct = ((curr - prev) / prev) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function humanizeCeilingType(type: string): string {
  const map: Record<string, string> = {
    confirmado_monto_maximo: "Confirmado — Monto máximo publicado",
    confirmado_suficiencia_presupuestal: "Confirmado — Suficiencia presupuestal",
    confirmado_valor_estimado: "Confirmado — Valor estimado oficial",
    contrato_abierto: "Confirmado — Contrato abierto (min/max)",
    antecedente_inmediato: "Estimado — Antecedente inmediato",
    historico_similar: "Estimado — Histórico de contratos similares",
    no_determinado: "No determinado — Información insuficiente",
  };
  return map[type] ?? type;
}

function buildCandidatesTable(candidates: SimilarCandidate[]): string {
  if (!candidates.length) return "_No se encontraron candidatos similares._";

  const header = "| Expediente | Objeto | Proveedor | Monto | Año | Score | Fuente |";
  const sep = "|---|---|---|---|---|---|---|";
  const rows = candidates.map((c) =>
    `| ${c.expediente ?? "N/D"} | ${(c.object ?? "N/D").slice(0, 50)} | ${c.supplier ?? "N/D"} | ${c.amount ? fmtCurrency(c.amount, "MXN") : "N/D"} | ${c.year ?? "N/D"} | ${c.score}/100 | ${c.sourceUrl ? `[ver](${c.sourceUrl})` : "N/D"} |`,
  );

  return [header, sep, ...rows].join("\n");
}

function buildWarnings(report: FinancialCeilingReport): string[] {
  const items: string[] = [];
  if (report.financialCeiling.type === "no_determinado")
    items.push("- ⚠️ No se encontró presupuesto explícito en documentos públicos.");
  if (report.financialCeiling.type === "contrato_abierto")
    items.push("- ℹ️ Es un contrato abierto: el monto final puede variar entre mínimo y máximo.");
  if (report.financialCeiling.confidence === "BAJA")
    items.push("- 🔴 Confianza BAJA — usar con mucha precaución.");
  if (!report.immediatePrecedent)
    items.push("- No se identificó antecedente inmediato de año anterior.");
  report.sourcesConsulted
    .filter((s) => s.status === "captcha")
    .forEach((s) => items.push(`- 🚫 ${s.document} requirió login/captcha — no consultada.`));
  report.sourcesConsulted
    .filter((s) => s.status === "blocked")
    .forEach((s) => items.push(`- 🔒 ${s.document} bloqueó el acceso.`));
  report.warnings.forEach((w) => items.push(`- ${w}`));
  return items.length ? items : ["- Sin alertas relevantes."];
}
