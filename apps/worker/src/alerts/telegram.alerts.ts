/**
 * TELEGRAM ALERTS — Formateador de mensajes y enviador.
 * Formato MarkdownV2 optimizado para legibilidad en Telegram.
 */
import TelegramBot from "node-telegram-bot-api";
import { getConfig } from "../config/env";
import { getCommandBot } from "../agent/telegram.commands";
import { createModuleLogger } from "../core/logger";
import { truncateForTelegram, formatCurrency } from "../core/text";
import { formatMexicoDate } from "../core/time";
import { TelegramError } from "../core/errors";
import { withRetries, isRetryableNetworkError } from "../utils/retry.util";
import type {
  EnrichedAlert,
  DailySummary,
  MatchLevel,
} from "../types/procurement";

const log = createModuleLogger("telegram-alerts");

let _bot: TelegramBot | null = null;

function getBot(): TelegramBot {
  // Reusar el bot de comandos (polling) si ya fue inicializado, para evitar
  // instancias duplicadas con el mismo token que provocan 409 Conflict.
  const cmdBot = getCommandBot();
  if (cmdBot) return cmdBot;
  if (_bot) return _bot;
  const config = getConfig();
  _bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: false });
  return _bot;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface AiVipAlertPayload {
  categoryDetected: string;
  relevanceJustification: string;
  score: {
    total: number;
    technical: number;
    commercial: number;
    urgency: number;
    viability: number;
  };
  licitacionRef: string;
  contractType: string;
  deadline: string;
  risks: string[];
  opportunities: string[];
  opportunityEngine: {
    winProbability: number;
    competitorThreatLevel: "LOW" | "MEDIUM" | "HIGH";
    implementationComplexity: "LOW" | "MEDIUM" | "HIGH";
    redFlags: string[];
  };
  link: string;
}

function getAiVipIcon(totalScore: number): "🔥" | "🟡" | null {
  if (totalScore >= 85) return "🔥";
  if (totalScore >= 70) return "🟡";
  return null;
}

function safeText(value: string | null | undefined, fallback: string): string {
  if (!value || typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function safeScore(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value as number))) : 0;
}

function buildAiVipFallbackMessage(payload: Partial<AiVipAlertPayload>): string {
  const reference = safeText(payload.licitacionRef, "Sin referencia");
  const link = safeText(payload.link, "https://comprasmx.buengobierno.gob.mx");

  const lines = [
    "⚠️ <b>ALERTA VIP (MODO RESILIENTE)</b>",
    "Se detectó una oportunidad, pero algunos campos de IA llegaron incompletos.",
    `📄 <b>Ref:</b> ${escapeHtml(reference)}`,
    `🔗 <a href="${escapeHtml(link)}">Ver Documento</a>`,
  ];

  return truncateForTelegram(lines.join("\n"));
}

export function formatAiVipAlertMessage(payload: AiVipAlertPayload): string | null {
  try {
    const totalScore = safeScore(payload?.score?.total);
    const icon = getAiVipIcon(totalScore);
    if (!icon) {
      return null;
    }

    const riskPrincipal = safeText(
      payload?.risks?.[0],
      "Sin riesgo principal detectado",
    );
    const opportunityPrincipal = safeText(
      payload?.opportunities?.[0],
      "Sin oportunidad principal detectada",
    );
    const redFlagPrincipal = safeText(
      payload?.opportunityEngine?.redFlags?.[0],
      "Sin candados relevantes detectados",
    );

    const lines = [
      `📂 <b>CATEGORÍA:</b> ${escapeHtml(safeText(payload?.categoryDetected, "NONE"))}`,
      `🎯 <b>RELEVANCIA:</b> ${escapeHtml(safeText(payload?.relevanceJustification, "Sin justificación disponible"))}`,
      `${icon} <b>SCORE: ${totalScore}/100</b>`,
      `🎯 <b>Probabilidad de Ganar:</b> ${safeScore(payload?.opportunityEngine?.winProbability)}%`,
      `🥷 <b>Amenaza de Competencia:</b> ${escapeHtml(safeText(payload?.opportunityEngine?.competitorThreatLevel, "MEDIUM"))}`,
      `⚙️ <b>Complejidad:</b> ${escapeHtml(safeText(payload?.opportunityEngine?.implementationComplexity, "MEDIUM"))}`,
      `🛑 <b>Red Flags (Candados):</b> ${escapeHtml(redFlagPrincipal)}`,
      `📄 <b>Ref:</b> ${escapeHtml(safeText(payload?.licitacionRef, "Sin referencia"))}`,
      `💰 <b>Tipo:</b> ${escapeHtml(safeText(payload?.contractType, "No especificado"))}`,
      `⏳ <b>Cierre:</b> ${escapeHtml(safeText(payload?.deadline, "No especificado"))}`,
      "",
      `📊 <b>Desglose:</b> Tec:${safeScore(payload?.score?.technical)} | Com:${safeScore(payload?.score?.commercial)} | Urg:${safeScore(payload?.score?.urgency)} | Via:${safeScore(payload?.score?.viability)}`,
      "",
      `⚠️ <b>Riesgo Principal:</b> ${escapeHtml(riskPrincipal)}`,
      `✅ <b>Oportunidad:</b> ${escapeHtml(opportunityPrincipal)}`,
      "",
      `🔗 <a href="${escapeHtml(safeText(payload?.link, "https://comprasmx.buengobierno.gob.mx"))}">Ver Documento</a>`,
    ];

    return truncateForTelegram(lines.join("\n"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err: message }, "Fallo construyendo mensaje VIP; usando fallback resiliente");
    return buildAiVipFallbackMessage(payload);
  }
}

// ─── Envío base ──────────────────────────────────────────────────────────────

export async function sendTelegramMessage(
  text: string,
  parseMode: "Markdown" | "HTML" = "HTML",
): Promise<number | null> {
  const config = getConfig();
  const bot = getBot();

  try {
    const msg = await withRetries(
      () =>
        bot.sendMessage(config.TELEGRAM_CHAT_ID, text, {
          parse_mode: parseMode,
          disable_web_page_preview: true,
        } as TelegramBot.SendMessageOptions),
      {
        maxAttempts: 3,
        initialDelayMs: 1_000,
        backoffMultiplier: 2,
        maxDelayMs: 4_000,
        shouldRetry: isRetryableNetworkError,
        onRetry: (_err, attempt, delay) =>
          log.warn({ attempt, delayMs: delay }, "⏳ Reintentando envío Telegram..."),
      },
    );
    return msg.message_id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg }, "❌ Error enviando mensaje Telegram (agotados reintentos)");
    throw new TelegramError(`Error enviando a Telegram: ${msg}`);
  }
}

export async function sendTelegramDocument(
  caption: string,
  filePath: string,
): Promise<number | null> {
  const config = getConfig();
  const bot = getBot();

  try {
    const msg = await bot.sendDocument(config.TELEGRAM_CHAT_ID, filePath, {
      caption,
      parse_mode: "HTML",
    });
    return msg.message_id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg, filePath }, "Error enviando documento Telegram");
    throw new TelegramError(`Error enviando documento a Telegram: ${msg}`);
  }
}

function chunkTextForTelegram(text: string, maxLen = 3500): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let splitIndex = remaining.lastIndexOf("\n", maxLen);
    if (splitIndex < Math.floor(maxLen * 0.5)) {
      splitIndex = maxLen;
    }
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

export async function sendTelegramLongReport(
  header: string,
  report: string,
): Promise<void> {
  const safeHeader = escapeHtml(header);
  const chunks = chunkTextForTelegram(report, 3400);

  await sendTelegramMessage(`🧠 <b>${safeHeader}</b>`, "HTML");

  for (const chunk of chunks) {
    const safeChunk = escapeHtml(chunk);
    await sendTelegramMessage(`<pre>${safeChunk}</pre>`, "HTML");
  }
}

// ─── Formato de alerta de match ──────────────────────────────────────────────

function matchLevelEmoji(level: MatchLevel): string {
  return level === "high" ? "🔴" : level === "medium" ? "🟡" : "🟢";
}

/**
 * Construye el mensaje HTML para alerta de nuevo match.
 */
export function formatMatchAlert(alert: EnrichedAlert): string {
  const p = alert.procurement;
  const emoji = matchLevelEmoji(alert.matchLevel);
  const score = (alert.matchScore * 100).toFixed(0);

  // Fechas reales del API (vienen en ISO "2026-04-17T10:30:00")
  const raw = p.rawJson as Record<string, unknown>;
  const fechaPublicacion = (raw.fecha_publicacion as string | null | undefined)
    ?? (raw.visibleDate as string | null | undefined)
    ?? null;
  const fechaAclaraciones = (raw.fecha_aclaraciones as string | null | undefined) ?? null;
  const fechaLimite = (raw.fecha_limite as string | null | undefined) ?? null;
  const fechaFallo = (raw.fecha_fallo as string | null | undefined) ?? null;
  const fechaVisita = (raw.fecha_visita as string | null | undefined) ?? null;
  const fechaInicioContrato = (raw.fecha_inicio_contrato as string | null | undefined) ?? null;

  const fmtDate = (d: string | null) =>
    d ? formatMexicoDate(d, "dd/MM/yyyy HH:mm") : null;

  const lines: string[] = [
    `${emoji} <b>NUEVO MATCH — ${alert.radarName}</b>`,
    `Nivel: <b>${alert.matchLevel.toUpperCase()}</b> | Score: ${score}%`,
    "",
    `📋 <b>Expediente:</b> ${p.expedienteId ?? "N/D"}`,
    `🔢 <b>Licitación:</b> ${p.licitationNumber ?? "No especificado"}`,
    `📝 <b>Proc. #:</b> ${p.procedureNumber ?? "N/D"}`,
    "",
    `📌 <b>${p.title}</b>`,
    "",
    `🏛 <b>Dependencia:</b> ${p.dependencyName ?? "N/D"}`,
    `🏢 <b>Unidad compradora:</b> ${p.buyingUnit ?? "N/D"}`,
    p.state
      ? `📍 <b>Ubicación:</b> ${p.municipality ? `${p.municipality}, ` : ""}${p.state}`
      : "",
    "",
    `📊 <b>Estatus:</b> ${p.status}`,
    p.amount ? `💰 <b>Monto:</b> ${formatCurrency(p.amount, p.currency)}` : "",
    alert.modalidadProbable
      ? `📋 <b>Modalidad probable:</b> ${alert.modalidadProbable.replace(/_/g, " ")}`
      : "",
    "",
    // Fechas reales disponibles en el API
    fechaPublicacion
      ? `📅 <b>Fecha de publicación:</b> ${fmtDate(fechaPublicacion)}`
      : "",
    p.openingDate
      ? `📂 <b>Apertura de proposiciones:</b> ${fmtDate(p.openingDate)}`
      : "",
    fechaAclaraciones
      ? `📋 <b>Junta de aclaraciones:</b> ${fmtDate(fechaAclaraciones)}`
      : "",
    fechaLimite
      ? `⏰ <b>Límite envío aclaraciones:</b> ${fmtDate(fechaLimite)}`
      : "",
    fechaVisita
      ? `🏛 <b>Visita a instalaciones:</b> ${fmtDate(fechaVisita)}`
      : "",
    fechaFallo
      ? `⚖️ <b>Acto del Fallo:</b> ${fmtDate(fechaFallo)}`
      : "",
    fechaInicioContrato
      ? `🗓 <b>Inicio estimado del contrato:</b> ${fmtDate(fechaInicioContrato)}`
      : "",
    "",
    `🎯 <b>Razón del match:</b>`,
    alert.explanation,
    "",
    `🔍 <b>Términos detectados:</b> ${alert.matchedTerms.slice(0, 8).join(" · ")}`,
    alert.procurement.attachments.length > 0
      ? `📎 <b>Adjuntos:</b> ${alert.procurement.attachments.length} archivo(s)`
      : "",
    alert.hasHistory
      ? `🔁 <b>Antecedentes:</b> ${alert.historyCount} versión(es) previa(s)`
      : "",
    "",
    `🔗 <b>Ver expediente:</b>`,
    p.sourceUrl,
    "",
    `⏱ Detectado: ${formatMexicoDate(alert.detectedAt)}`,
  ];

  return truncateForTelegram(lines.filter(Boolean).join("\n"));
}

/**
 * Formatea alerta de cambio de estatus.
 */
export function formatStatusChangeAlert(
  alert: EnrichedAlert,
  previousStatus: string,
): string {
  const p = alert.procurement;

  const lines: string[] = [
    `🔄 <b>CAMBIO DE ESTATUS — ${alert.radarName}</b>`,
    "",
    `📋 <b>Expediente:</b> ${p.expedienteId ?? "N/D"}`,
    `📌 <b>${p.title}</b>`,
    "",
    `🏛 <b>Dependencia:</b> ${p.dependencyName ?? "N/D"}`,
    "",
    `📊 <b>Estatus anterior:</b> ${previousStatus}`,
    `📊 <b>Estatus nuevo:</b> <b>${p.status}</b>`,
    "",
    `🔗 ${p.sourceUrl}`,
    `⏱ ${formatMexicoDate(alert.detectedAt)}`,
  ];

  return truncateForTelegram(lines.join("\n"));
}

/**
 * Formatea el resumen diario.
 */
export function formatDailySummaryMessage(summary: DailySummary): string {
  const lines: string[] = [
    `📊 <b>RESUMEN DIARIO — ${summary.summaryDate}</b>`,
    `<i>Radar Licitaciones MX</i>`,
    "",
    `👁 <b>Total revisado:</b> ${summary.totalSeen}`,
    `🆕 <b>Nuevos expedientes:</b> ${summary.totalNew}`,
    `🔄 <b>Actualizados:</b> ${summary.totalUpdated}`,
    `🎯 <b>Matches encontrados:</b> ${summary.totalMatches}`,
    `📨 <b>Alertas enviadas:</b> ${summary.totalAlerts}`,
    "",
    `<b>📡 Matches por radar:</b>`,
    ...Object.entries(summary.matchesByRadar).map(
      ([key, count]) => `  • ${key}: ${count}`,
    ),
    "",
  ];

  if (summary.topDependencies.length > 0) {
    lines.push("<b>🏛 Dependencias más activas:</b>");
    summary.topDependencies.slice(0, 5).forEach((d, i) => {
      lines.push(`  ${i + 1}. ${d.name} (${d.count})`);
    });
    lines.push("");
  }

  if (summary.technicalIncidents.length > 0) {
    lines.push("<b>⚠️ Incidencias técnicas:</b>");
    summary.technicalIncidents.forEach((inc) => lines.push(`  • ${inc}`));
    lines.push("");
  }

  return truncateForTelegram(lines.join("\n"));
}

// ─── Envíos de alto nivel ─────────────────────────────────────────────────────

export async function sendMatchAlert(
  alert: EnrichedAlert,
): Promise<number | null> {
  const message =
    alert.alertType === "status_change"
      ? formatStatusChangeAlert(alert, alert.procurement.status)
      : formatMatchAlert(alert);

  return sendTelegramMessage(message, "HTML");
}

export async function sendDailySummary(
  summary: DailySummary,
): Promise<number | null> {
  const message = formatDailySummaryMessage(summary);
  return sendTelegramMessage(message, "HTML");
}

export async function sendSystemMessage(text: string): Promise<number | null> {
  return sendTelegramMessage(text, "HTML");
}
