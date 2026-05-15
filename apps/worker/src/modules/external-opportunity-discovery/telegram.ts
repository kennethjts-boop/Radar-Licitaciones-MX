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

  const lines = [
    "🧭 <b>LEAD OSINT DETECTADO</b>",
    "",
    `🏷 <b>Vertical:</b> ${escapeHtml(businessLine.displayName)}`,
    `🏢 <b>Organización:</b> ${escapeHtml(lead.organizationName ?? "N/D")}`,
    `📍 <b>Ubicación:</b> ${escapeHtml(location)}`,
    `📌 <b>Tipo:</b> ${escapeHtml(opportunityTypeLabel(lead.opportunityType))}`,
    `📊 <b>Score:</b> ${lead.estimatedInterestScore}/100 ${lead.confidence}`,
    `🔎 <b>Coincidencias:</b> ${escapeHtml(keywords || "N/D")}`,
    `🧾 <b>Evidencia:</b> ${escapeHtml(evidence)}`,
    `🔗 <b>Fuente:</b> <a href="${escapeHtml(lead.sourceUrl)}">abrir fuente</a>`,
    `➡️ <b>Siguiente acción:</b> ${escapeHtml(lead.nextAction)}`,
  ];

  return truncateForTelegram(lines.join("\n"));
}

export async function sendExternalLeadAlert(lead: ExternalLead): Promise<number | null> {
  return sendTelegramMessage(formatExternalLeadAlert(lead), "HTML");
}
