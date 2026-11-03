/**
 * Formato determinista (HTML de Telegram) del reporte diario de gastos.
 * Sin IA: mismas métricas → mismo texto.
 */
import { formatInTimeZone } from "date-fns-tz";
import { MX_TIMEZONE } from "../../core/time";
import { providerLabel } from "./analysis";
import { coverageNote } from "./coverage";
import { usd } from "./money";
import { PRICING_CHECKED_AT } from "./pricing";
import type { AiModelStats, AnomalyThresholds, DayCostMetrics, MetricComparison, ProviderLine } from "./types";

const MAX_MODELS = 5;
const TELEGRAM_LIMIT = 4000;

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export { usd };

function count(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function fmt(unit: "usd" | "count", v: number): string {
  return unit === "usd" ? usd(v) : count(v);
}

function delta(unit: "usd" | "count", value: number, base: number | null): string {
  if (base === null) return "sin datos";
  const diff = value - base;
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
  const abs = fmt(unit, Math.abs(diff));
  const pct = base > 0 ? ` (${sign}${Math.round((Math.abs(diff) / base) * 100)}%)` : "";
  return `${sign}${abs.replace(/^−/, "")}${pct}`;
}

function comparisonLine(c: MetricComparison, minDays: number): string {
  if (c.status === "baseline") {
    return `vs ayer ${delta(c.unit, c.value, c.previous)} · prom. 7 d: formando línea base (${c.sampleDays}/${minDays} días)`;
  }
  return `vs ayer ${delta(c.unit, c.value, c.previous)} · vs prom. 7 d ${fmt(c.unit, c.average as number)} (n=${c.sampleDays}) ${delta(c.unit, c.value, c.average)}`;
}

function dateMx(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

const COVERAGE_LABEL: Record<string, string> = {
  complete: "completa",
  partial: "medición parcial",
  none: "sin datos",
  not_applicable: "n/a (no usa el registro de IA)",
};

function aiConsumption(metrics: DayCostMetrics, provider: "openai" | "openrouter"): string | null {
  const models = metrics.ai?.byModel.filter((m) => m.provider === provider);
  if (!models) return null;
  const sum = (f: (m: AiModelStats) => number) => models.reduce((a, m) => a + f(m), 0);
  return `${count(sum((m) => m.requests))} sol (${count(sum((m) => m.errors))} err) · tokens ${count(sum((m) => m.inputTokens))} entrada / ${count(sum((m) => m.outputTokens))} salida`;
}

/** Resumen por proveedor: consumo medido | costo | cobertura | pendiente. */
function providerBlock(line: ProviderLine, metrics: DayCostMetrics): string[] {
  const name = providerLabel(line.provider);
  const cov = line.coverage;
  const costs: string[] = [];
  if (line.reportedUsd !== null) costs.push(`real ${usd(line.reportedUsd)}`);
  if (line.estimatedUsd !== null) {
    const partial = cov?.status === "partial" ? " · medición parcial" : "";
    costs.push(`estimado ${usd(line.estimatedUsd)}${line.estimateDetail ? ` (${esc(line.estimateDetail)})` : ""}${partial}`);
  }
  const noCost = cov?.status === "none" ? "sin datos" : "no disponible";
  const icon = line.reportedUsd !== null ? "🟢" : line.estimatedUsd !== null ? "🟡" : "⚪";
  const consumption =
    line.provider === "openai" || line.provider === "openrouter"
      ? cov?.status === "none"
        ? "sin datos"
        : aiConsumption(metrics, line.provider) ?? "no disponible (ai_usage_events sin acceso)"
      : line.metricsDetail ?? "no disponible";
  const out = [
    `${icon} <b>${name}</b>`,
    `   consumo: ${esc(consumption)}`,
    `   costo: ${costs.length ? costs.join(" · ") : noCost}`,
  ];
  if (cov) {
    const note = cov.status === "complete" || cov.status === "not_applicable" ? COVERAGE_LABEL[cov.status] : cov.note ?? COVERAGE_LABEL[cov.status];
    out.push(`   cobertura: ${esc(note)}`);
  }
  if (line.reconciliation) out.push(`   contraste: ${esc(line.reconciliation)}`);
  if (line.reference) {
    out.push(`   ref. ${usd(line.reference.usd)} · ${esc(line.reference.period)} · ${esc(line.reference.reason)}`);
  }
  for (const m of line.missing) out.push(`   ⏳ ${esc(m)}`);
  return out;
}

export interface FormatOptions {
  generatedAt: Date;
  thresholds: AnomalyThresholds;
  lateNote?: string;
}

export function formatCostReport(
  metrics: DayCostMetrics,
  comparisons: MetricComparison[],
  opts: FormatOptions,
): string {
  const t = opts.thresholds;
  const byKey = new Map(comparisons.map((c) => [c.key, c]));
  const startZ = formatInTimeZone(new Date(metrics.periodStartUtc), "UTC", "dd/MM HH:mm'Z'");
  const endZ = formatInTimeZone(new Date(metrics.periodEndUtc), "UTC", "dd/MM HH:mm'Z'");
  const lines: string[] = [
    `💰 <b>Radar · Gastos del ${dateMx(metrics.date)}</b>`,
    `Periodo: 00:00–24:00 America/Mexico_City (${startZ} → ${endZ})`,
  ];
  if (metrics.coverage) {
    lines.push(`Cobertura registro IA: ${esc(coverageNote(metrics.coverage))}`);
  } else {
    lines.push("Cobertura registro IA: desconocida (reporte previo a la medición de cobertura)");
  }
  if (opts.lateNote) lines.push(`⏱ ${esc(opts.lateNote)}`);

  // Totales
  lines.push("", "<b>Totales USD</b> (confirmado y estimado no se suman entre sí)");
  const tot = metrics.totals;
  if (tot.confirmedUsd !== null) {
    lines.push(`• Confirmado: ${usd(tot.confirmedUsd)} (${tot.confirmedProviders.map(providerLabel).join(", ")})`);
    const c = byKey.get("total.confirmed");
    if (c) lines.push(`  ${comparisonLine(c, t.minDays)}`);
  } else {
    lines.push("• Confirmado: no disponible (ninguna fuente real alineada al día MX y atribuible a Radar)");
  }
  if (tot.estimatedUsd !== null) {
    const partial = [
      tot.estimateExcludes.length ? `excluye ${tot.estimateExcludes.map(providerLabel).join(", ")}` : "",
      tot.estimatePartial?.length ? `medición parcial de ${tot.estimatePartial.map(providerLabel).join(", ")}` : "",
    ].filter(Boolean).join("; ");
    lines.push(`• Estimado: ${usd(tot.estimatedUsd)} (${tot.estimatedProviders.map(providerLabel).join(", ")}${partial ? `; ${partial}` : ""})`);
    const c = byKey.get("total.estimated");
    if (c) lines.push(`  ${comparisonLine(c, t.minDays)}`);
  } else {
    lines.push("• Estimado: no disponible");
  }

  // Proveedores
  lines.push("", "<b>Por proveedor</b> (consumo · costo · cobertura · ⏳ pendiente)");
  for (const p of metrics.providers) lines.push(...providerBlock(p, metrics));

  // IA
  lines.push("", "<b>IA (registro Radar)</b>");
  const ai = metrics.ai;
  const covStatus = metrics.coverage?.status;
  if (covStatus === "none") {
    lines.push(`• ${esc(coverageNote(metrics.coverage!))}`);
  } else if (!ai) {
    lines.push("• No disponible (tabla ai_usage_events sin acceso o migración pendiente)");
  } else if (ai.requests === 0) {
    lines.push(`• 0 solicitudes registradas${covStatus === "partial" ? " (medición parcial)" : ""}`);
  } else {
    lines.push(`• Solicitudes observadas ${count(ai.requests)} · errores ${count(ai.errors)}${covStatus === "partial" ? " (medición parcial)" : ""}`);
    const unobserved = ai.retriesUnobserved ?? 0;
    lines.push(
      `• Reintentos: pool de modelos ${count(ai.retries)} · internos del SDK ${count(ai.httpRetries ?? 0)}${unobserved ? ` · no medibles en ${count(unobserved)} solicitudes` : ""}`,
    );
    lines.push(`• Tokens: entrada ${count(ai.inputTokens)} · salida ${count(ai.outputTokens)}`);
    for (const key of ["ai.requests", "ai.errors", "ai.retries"]) {
      const c = byKey.get(key);
      if (c && c.status !== "baseline") lines.push(`  ${esc(c.label)}: ${comparisonLine(c, t.minDays)}`);
    }
    const kinds = Object.entries(ai.errorKinds).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (kinds.length) lines.push(`• Errores por tipo: ${kinds.map(([k, n]) => `${esc(k)} ${n}`).join(", ")}`);
    for (const m of ai.byModel.slice(0, MAX_MODELS)) {
      const cost = m.estimatedUsd !== null ? usd(m.estimatedUsd) : "sin tarifa";
      lines.push(
        `  · ${esc(m.model)} (${m.provider}): ${m.requests} sol · ${m.errors} err · ${count(m.inputTokens + m.outputTokens)} tok · ${cost}`,
      );
    }
    if (ai.byModel.length > MAX_MODELS) lines.push(`  · …y ${ai.byModel.length - MAX_MODELS} modelos más`);
    if (ai.unpricedRequests) lines.push(`• ${ai.unpricedRequests} solicitudes sin tarifa conocida (no estimadas)`);
    if (ai.unverifiedPricingModels.length) {
      lines.push(`• Tarifa sin verificación oficial: ${ai.unverifiedPricingModels.map(esc).join(", ")}`);
    }
  }

  // Revisión
  const review = comparisons.filter((c) => c.status === "review");
  const baseline = comparisons.some((c) => c.status === "baseline");
  lines.push(
    "",
    `<b>Revisión</b> (umbral: >${t.pct}% sobre prom. 7 d y >${usd(t.minUsd)}; ≥${t.minDays} días comparables con cobertura completa)`,
  );
  if (covStatus !== "complete") {
    lines.push("• Métricas de IA sin comparar: el día no tiene cobertura completa (no entra a promedios ni anomalías).");
  }
  if (review.length) {
    for (const c of review) {
      const avg = c.average as number;
      lines.push(
        `⚠️ ${esc(c.label)}: ${fmt(c.unit, c.value)} vs prom. ${fmt(c.unit, avg)}: ${delta(c.unit, c.value, avg)} → revisar ${esc(c.whereToCheck)}`,
      );
    }
    lines.push("Señal para revisión, no prueba de fraude ni de cobro indebido.");
  } else if (!comparisons.length) {
    if (covStatus === "complete") lines.push("• Sin métricas comparables.");
  } else if (baseline && !comparisons.some((c) => c.status === "ok")) {
    lines.push(`• Formando línea base: aún no hay ${t.minDays} días comparables.`);
  } else {
    lines.push(`• Sin aumentos fuera de umbral${baseline ? " (algunas métricas aún forman línea base)" : ""}.`);
  }

  lines.push("", "MXN: sin conversión (no hay fuente de tipo de cambio configurada)");

  lines.push(
    "",
    `<i>Generado ${formatInTimeZone(opts.generatedAt, MX_TIMEZONE, "dd/MM/yyyy HH:mm")} CDMX sin IA · tarifas consultadas ${PRICING_CHECKED_AT}</i>`,
  );

  let text = lines.join("\n");
  // Primero se sacrifica el desglose por modelo; las secciones de revisión y
  // cobertura se conservan.
  if (text.length > TELEGRAM_LIMIT) {
    const kept = lines.filter((l) => !l.startsWith("  · "));
    if (kept.length < lines.length) kept.splice(kept.indexOf("<b>IA (registro Radar)</b>") + 1, 0, "• Desglose por modelo omitido por longitud (ver ai_usage_events)");
    text = kept.join("\n");
  }
  // Cada línea tiene sus etiquetas HTML balanceadas: se corta en salto de línea.
  if (text.length > TELEGRAM_LIMIT) {
    text = `${text.slice(0, text.lastIndexOf("\n", TELEGRAM_LIMIT - 20))}\n…(recortado)`;
  }
  return text;
}
