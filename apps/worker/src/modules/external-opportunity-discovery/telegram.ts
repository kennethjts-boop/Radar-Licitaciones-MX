import { truncateForTelegram } from "../../core/text";
import { sendTelegramMessage } from "../../alerts/telegram.alerts";
import type { ExternalLead, ExternalOpportunityType } from "./types";
import { getBusinessLineConfig } from "./keywords";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function opportunityTypeLabel(type: ExternalOpportunityType): string {
  switch (type) {
    case "licitacion":
      return "licitación";
    case "licitacion_proxima":
      return "licitación próxima";
    case "contrato_historico":
      return "contrato histórico";
    case "senal_comercial_publica":
      return "señal comercial pública";
  }
}

export function formatExternalLeadAlert(lead: ExternalLead): string {
  const businessLine = getBusinessLineConfig(lead.vertical);
  const location = [lead.state, lead.municipality].filter(Boolean).join(" / ") || "N/D";
  const keywords = lead.matchedKeywords.slice(0, 8).join(" · ");
  const evidence = lead.evidenceText.replace(/\s+/g, " ").slice(0, 420);
  const scoreReasons = (lead.scoreReasons ?? [])
    .slice(0, 6)
    .map((reason) => `• ${escapeHtml(reason)}`)
    .join("\n");
  const opportunityReason =
    lead.opportunityType === "licitacion" || lead.opportunityType === "licitacion_proxima"
      ? "posible oportunidad pública con ventana de revisión"
      : "posible oportunidad pública para validación manual";

  const lines = [
    "🧭 <b>POSIBLE OPORTUNIDAD PÚBLICA OSINT</b>",
    "",
    `🏷 <b>Título:</b> ${escapeHtml(lead.title)}`,
    `🏷 <b>Vertical:</b> ${escapeHtml(businessLine.displayName)}`,
    `🏢 <b>Organización:</b> ${escapeHtml(lead.organizationName ?? "N/D")}`,
    `📍 <b>Ubicación:</b> ${escapeHtml(location)}`,
    `📌 <b>Tipo:</b> ${escapeHtml(opportunityTypeLabel(lead.opportunityType))}`,
    `📊 <b>Score:</b> ${lead.estimatedInterestScore}/100 ${lead.confidence}`,
    scoreReasons ? `🧮 <b>Razones:</b>\n${scoreReasons}` : "",
    `🔎 <b>Coincidencias:</b> ${escapeHtml(keywords || "N/D")}`,
    `🧾 <b>Evidencia:</b> ${escapeHtml(evidence)}`,
    `🔗 <b>Fuente:</b> <a href="${escapeHtml(lead.sourceUrl)}">abrir fuente</a>`,
    `🎯 <b>Motivo:</b> ${escapeHtml(opportunityReason)}`,
    `⚠️ <b>Riesgo:</b> requiere confirmación manual; no implica irregularidad ni acusación`,
    `➡️ <b>Recomendación:</b> ${escapeHtml(lead.nextAction)}`,
  ];

  return truncateForTelegram(lines.filter(Boolean).join("\n"));
}

export async function sendExternalLeadAlert(lead: ExternalLead): Promise<number | null> {
  return sendTelegramMessage(formatExternalLeadAlert(lead), "HTML");
}
