/**
 * Formato determinista (HTML de Telegram) del reporte diario de gastos.
 * Sin IA: mismas métricas → mismo texto.
 */
import { formatInTimeZone } from "date-fns-tz";
import { MX_TIMEZONE } from "../../core/time";
import { providerLabel } from "./analysis";
import { PRICING_CHECKED_AT } from "./pricing";
import type { AnomalyThresholds, DayCostMetrics, MetricComparison, ProviderLine } from "./types";

const MAX_MODELS = 5;
const TELEGRAM_LIMIT = 4000;

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function usd(value: number): string {
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  return `${value < 0 ? "−" : ""}US$${abs.toFixed(digits)}`;
}

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

function providerBlock(line: ProviderLine): string[] {
  const name = providerLabel(line.provider);
  const parts: string[] = [];
  if (line.reportedUsd !== null) parts.push(`reportado ${usd(line.reportedUsd)}`);
  if (line.estimatedUsd !== null) {
    parts.push(`estimado ${usd(line.estimatedUsd)}${line.estimateDetail ? ` (${esc(line.estimateDetail)})` : ""}`);
  }
  const icon = line.reportedUsd !== null ? "🟢" : line.estimatedUsd !== null ? "🟡" : "⚪";
  const out = [`${icon} <b>${name}</b> — ${parts.length ? parts.join(" · ") : "costo no disponible"}`];
  if (line.metricsDetail) out.push(`   uso: ${esc(line.metricsDetail)}`);
  if (line.reference) {
    out.push(`   ref. ${usd(line.reference.usd)} · ${esc(line.reference.period)} · ${esc(line.reference.reason)}`);
  }
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
    const partial = tot.estimateExcludes.length
      ? `; parcial, excluye ${tot.estimateExcludes.map(providerLabel).join(", ")}`
      : "";
    lines.push(`• Estimado: ${usd(tot.estimatedUsd)} (${tot.estimatedProviders.map(providerLabel).join(", ")}${partial})`);
    const c = byKey.get("total.estimated");
    if (c) lines.push(`  ${comparisonLine(c, t.minDays)}`);
  } else {
    lines.push("• Estimado: no disponible");
  }

  // Proveedores
  lines.push("", "<b>Por proveedor</b>");
  for (const p of metrics.providers) lines.push(...providerBlock(p));

  // IA
  lines.push("", "<b>IA (registro Radar)</b>");
  const ai = metrics.ai;
  if (!ai) {
    lines.push("• No disponible (tabla ai_usage_events sin acceso o migración pendiente)");
  } else if (ai.requests === 0) {
    lines.push("• 0 solicitudes registradas");
  } else {
    lines.push(`• Solicitudes ${count(ai.requests)} · errores ${count(ai.errors)} · reintentos ${count(ai.retries)}`);
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
    `<b>Revisión</b> (umbral: >${t.pct}% sobre prom. 7 d y >${usd(t.minUsd)}; ≥${t.minDays} días comparables)`,
  );
  if (review.length) {
    for (const c of review) {
      const avg = c.average as number;
      lines.push(
        `⚠️ ${esc(c.label)}: ${fmt(c.unit, c.value)} vs prom. ${fmt(c.unit, avg)}: ${delta(c.unit, c.value, avg)} → revisar ${esc(c.whereToCheck)}`,
      );
    }
    lines.push("Señal para revisión, no prueba de fraude ni de cobro indebido.");
  } else if (baseline && !comparisons.some((c) => c.status === "ok")) {
    lines.push("• Formando línea base: aún no hay 3 días comparables.");
  } else {
    lines.push(`• Sin aumentos fuera de umbral${baseline ? " (algunas métricas aún forman línea base)" : ""}.`);
  }

  // Faltantes
  const missing = metrics.providers.flatMap((p) => p.missing);
  lines.push("", "<b>Datos faltantes y retrasos</b>");
  for (const m of missing) lines.push(`• ${esc(m)}`);
  if (!missing.length) lines.push("• Ninguno");
  lines.push("• MXN: sin conversión (no hay fuente de tipo de cambio configurada)");

  lines.push(
    "",
    `<i>Generado ${formatInTimeZone(opts.generatedAt, MX_TIMEZONE, "dd/MM/yyyy HH:mm")} CDMX sin IA · tarifas consultadas ${PRICING_CHECKED_AT}</i>`,
  );

  let text = lines.join("\n");
  // Cada línea tiene sus etiquetas HTML balanceadas: se corta en salto de línea.
  if (text.length > TELEGRAM_LIMIT) {
    text = `${text.slice(0, text.lastIndexOf("\n", TELEGRAM_LIMIT - 20))}\n…(recortado)`;
  }
  return text;
}
