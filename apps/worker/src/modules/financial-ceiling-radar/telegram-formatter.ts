/**
 * TELEGRAM FORMATTER — Formatea el reporte para Telegram.
 *
 * Usa HTML parse_mode (igual que el resto del bot existente).
 * Formato compacto para no exceder el límite de 4096 chars.
 */

import { FinancialCeilingReport } from "./types";

const MAX_TG_LENGTH = 4000;

/**
 * Formatea el reporte completo para Telegram en HTML.
 */
export function formatTelegramMessage(report: FinancialCeilingReport): string {
  const { currentTender: t, financialCeiling: fc, immediatePrecedent: ip } = report;

  const amountStr = fc.amount
    ? fmtCurrency(fc.amount, fc.currency)
    : "No determinado";

  const rangeStr =
    fc.rangeMin && fc.rangeMax && fc.rangeMin !== fc.amount
      ? `${fmtCurrency(fc.rangeMin, fc.currency)} — ${fmtCurrency(fc.rangeMax, fc.currency)}`
      : amountStr;

  const confidenceIcon =
    fc.confidence === "ALTA" ? "🟢" : fc.confidence === "MEDIA" ? "🟡" : "🔴";

  const variacion =
    ip?.amount && fc.amount && ip.amount > 0
      ? calcVariacion(ip.amount, fc.amount)
      : "N/D";

  const topSources = report.sourcesConsulted
    .filter((s) => s.status === "ok" || s.status === "not_found")
    .slice(0, 3);

  const alerts = [
    ...report.warnings.map((w) => `• ${truncate(w, 120)}`),
    ...report.sourcesConsulted
      .filter((s) => s.status === "captcha")
      .map((s) => `• ${s.document}: requirió login/captcha`),
    ...report.errors.map((e) => `• Error: ${truncate(e, 80)}`),
  ].slice(0, 5);

  const lines: string[] = [
    `📊 <b>ANÁLISIS DE TECHO FINANCIERO</b>`,
    ``,
    `🔎 <b>Consulta:</b>`,
    `<code>${esc(report.query)}</code>`,
    ``,
    `🏛 <b>Dependencia:</b>`,
    esc(t.agency ?? "No identificada"),
    ``,
    `📄 <b>Objeto:</b>`,
    esc(truncate(t.object ?? "N/D", 150)),
    ``,
    `💰 <b>Techo financiero:</b>`,
    `<b>${esc(rangeStr)}</b>`,
    ``,
    `📌 <b>Tipo:</b>`,
    esc(humanizeCeilingType(fc.type)),
    ``,
    `${confidenceIcon} <b>Confianza:</b> <b>${fc.confidence}</b>`,
    ``,
  ];

  if (ip) {
    lines.push(
      `📁 <b>Antecedente inmediato:</b>`,
      `<code>${esc(ip.tenderNumber ?? ip.contractNumber ?? "N/D")}</code>`,
      ``,
      `🏢 <b>Proveedor anterior:</b>`,
      esc(ip.supplier ?? "N/D"),
      ``,
      `💵 <b>Monto anterior:</b>`,
      ip.amount ? esc(fmtCurrency(ip.amount, ip.currency)) : "N/D",
      ``,
      `📅 <b>Fecha:</b>`,
      esc(ip.date ?? "N/D"),
      ``,
      `📈 <b>Variación estimada:</b> ${esc(variacion)}`,
      ``,
    );
  } else {
    lines.push(
      `📁 <b>Antecedente inmediato:</b>`,
      `No identificado`,
      ``,
    );
  }

  if (topSources.length > 0) {
    lines.push(`🔗 <b>Fuentes consultadas:</b>`);
    topSources.forEach((s, i) => {
      lines.push(`${i + 1}. ${esc(s.document)} — <a href="${s.url}">ver</a>`);
    });
    lines.push(``);
  }

  if (alerts.length > 0) {
    lines.push(`⚠️ <b>Alertas:</b>`);
    alerts.forEach((a) => lines.push(esc(a)));
  }

  const message = lines.join("\n");

  // Truncar si excede límite de Telegram
  if (message.length > MAX_TG_LENGTH) {
    return message.slice(0, MAX_TG_LENGTH - 50) + "\n\n<i>...mensaje truncado</i>";
  }

  return message;
}

/**
 * Mensaje de error cuando no hay información suficiente.
 */
export function formatTelegramErrorMessage(
  query: string,
  sources: { document: string; status: string }[],
  reason: string,
): string {
  const sourceList = sources
    .slice(0, 5)
    .map((s) => `• ${esc(s.document)}: ${esc(s.status)}`)
    .join("\n");

  return [
    `📊 <b>ANÁLISIS DE TECHO FINANCIERO</b>`,
    ``,
    `No pude estimar un techo financiero confiable con fuentes públicas suficientes.`,
    ``,
    `🔎 <b>Consulta:</b>`,
    `<code>${esc(query)}</code>`,
    ``,
    `📡 <b>Fuentes revisadas:</b>`,
    sourceList || "• Ninguna disponible",
    ``,
    `❓ <b>Motivo:</b>`,
    esc(reason),
  ].join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(amount: number, currency: "MXN" | "USD"): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function calcVariacion(prev: number, curr: number): string {
  const pct = ((curr - prev) / prev) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function humanizeCeilingType(type: string): string {
  const map: Record<string, string> = {
    confirmado_monto_maximo: "Confirmado por monto máximo publicado",
    confirmado_suficiencia_presupuestal: "Confirmado por suficiencia presupuestal",
    confirmado_valor_estimado: "Confirmado por valor estimado",
    contrato_abierto: "Contrato abierto (monto mínimo y máximo)",
    antecedente_inmediato: "Estimado por antecedente inmediato",
    historico_similar: "Estimado por histórico de contratos similares",
    no_determinado: "No determinado — información insuficiente",
  };
  return map[type] ?? type;
}

/**
 * Escapa caracteres HTML para Telegram parse_mode HTML.
 */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}
