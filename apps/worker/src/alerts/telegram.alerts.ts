/**
 * TELEGRAM ALERTS — Formateador de mensajes y enviador.
 * Formato MarkdownV2 optimizado para legibilidad en Telegram.
 */
import TelegramBot from "node-telegram-bot-api";
import { getConfig } from "../config/env";
import { getCommandBot } from "../agent/telegram.commands";
import { createModuleLogger } from "../core/logger";
import { truncateForTelegram, formatCurrency, normalizeText } from "../core/text";
import { formatMexicoDate, formatDateSafe } from "../core/time";
import { TelegramError, withTimeout } from "../core/errors";
import { withRetries, isRetryableNetworkError } from "../utils/retry.util";
import type {
  EnrichedAlert,
  DailySummary,
  PublicTenderDocument,
} from "../types/procurement";
import type { SummaryData } from '../modules/alert-filter';
import type { DocumentLink } from "../collectors/comprasmx-detail/index";
import type { DownloadResult } from "../services/document-downloader";
import type { CeilingResult } from "../services/budget-ceiling-engine";
import type { SimilarProcedure } from "../services/procurement-similarity-engine";
import {
  recordTelegramSendFailure,
  recordTelegramSendSuccess,
} from "../core/telegram-commands-health";
import { detectPriorityAlertProfile } from "../modules/priority-alerts";
import { telegramBotConstructorOptions } from "../core/telegram-client-options";
import { writeTelegramLog } from "../storage/telegram-log.repo";

const log = createModuleLogger("telegram-alerts");

let _bot: TelegramBot | null = null;

export type TelegramSendErrorKind = "timeout" | "network" | "api" | "unknown";

export interface TelegramSendErrorDetails {
  kind: TelegramSendErrorKind;
  retryable: boolean;
  code?: string;
  statusCode?: number;
  apiErrorCode?: number;
  apiDescription?: string;
  summary: string;
}

function toErrorSummary(err: unknown): string {
  if (err instanceof AggregateError) {
    const parts = err.errors
      .map((item) => (item instanceof Error ? item.message : String(item)))
      .filter(Boolean);
    return parts.length > 0 ? parts.join(" | ") : err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function getErrorCandidates(err: unknown): unknown[] {
  if (err instanceof AggregateError) {
    return [err, ...err.errors];
  }
  if (typeof err === "object" && err !== null && Array.isArray((err as { errors?: unknown[] }).errors)) {
    return [err, ...(err as { errors: unknown[] }).errors];
  }
  return [err];
}

function hasTimeoutSignal(text: string): boolean {
  return [
    "timeout",
    "timed out",
    "etimedout",
    "aborterror",
    "aborted",
  ].some((token) => text.includes(token));
}

function isRetryableTelegramApiStatus(statusCode: number | undefined, apiErrorCode: number | undefined): boolean {
  if (statusCode === undefined && apiErrorCode === undefined) return false;
  if (statusCode === 429 || apiErrorCode === 429) return true;
  if (statusCode !== undefined && statusCode >= 500) return true;
  return false;
}

export function describeTelegramSendError(err: unknown): TelegramSendErrorDetails {
  const candidates = getErrorCandidates(err);
  const summary = toErrorSummary(err);

  let code: string | undefined;
  let statusCode: number | undefined;
  let apiErrorCode: number | undefined;
  let apiDescription: string | undefined;

  for (const item of candidates) {
    if (typeof item !== "object" || item === null) continue;

    const maybeError = item as {
      code?: unknown;
      response?: { statusCode?: unknown; body?: { error_code?: unknown; description?: unknown } };
    };
    if (!code && typeof maybeError.code === "string") {
      code = maybeError.code;
    }
    const response = maybeError.response;
    if (response && typeof response.statusCode === "number" && statusCode === undefined) {
      statusCode = response.statusCode;
    }
    const body = response?.body;
    if (body && typeof body.error_code === "number" && apiErrorCode === undefined) {
      apiErrorCode = body.error_code;
    }
    if (body && typeof body.description === "string" && !apiDescription) {
      apiDescription = body.description;
    }
  }

  const combinedText = candidates
    .map((item) => (item instanceof Error ? `${item.name} ${item.message} ${item.stack ?? ""}` : String(item)))
    .join(" ")
    .toLowerCase();

  if (hasTimeoutSignal(combinedText)) {
    return {
      kind: "timeout",
      retryable: true,
      code,
      statusCode,
      apiErrorCode,
      apiDescription,
      summary,
    };
  }

  const hasTelegramApiMetadata = statusCode !== undefined || apiErrorCode !== undefined || code === "ETELEGRAM";
  if (hasTelegramApiMetadata) {
    return {
      kind: "api",
      retryable: isRetryableTelegramApiStatus(statusCode, apiErrorCode),
      code,
      statusCode,
      apiErrorCode,
      apiDescription,
      summary,
    };
  }

  // EFATAL de node-telegram-bot-api con AggregateError interior = fallo de red transitorio
  if (code === "EFATAL") {
    return {
      kind: "network",
      retryable: true,
      code,
      statusCode,
      apiErrorCode,
      apiDescription,
      summary,
    };
  }

  if (isRetryableNetworkError(err)) {
    return {
      kind: "network",
      retryable: true,
      code,
      statusCode,
      apiErrorCode,
      apiDescription,
      summary,
    };
  }

  return {
    kind: "unknown",
    retryable: false,
    code,
    statusCode,
    apiErrorCode,
    apiDescription,
    summary,
  };
}

function formatTelegramFailureMessage(details: TelegramSendErrorDetails): string {
  const parts = [`Error enviando a Telegram (${details.kind})`];
  if (details.statusCode !== undefined) parts.push(`status=${details.statusCode}`);
  if (details.apiErrorCode !== undefined) parts.push(`api_error_code=${details.apiErrorCode}`);
  if (details.code) parts.push(`code=${details.code}`);
  if (details.apiDescription) parts.push(`description=${details.apiDescription}`);
  parts.push(`reason=${details.summary}`);
  return parts.join(" | ");
}

function getBot(): TelegramBot {
  // Reusar el bot de comandos (polling) si ya fue inicializado, para evitar
  // instancias duplicadas con el mismo token que provocan 409 Conflict.
  const cmdBot = getCommandBot();
  if (cmdBot) return cmdBot;
  if (_bot) return _bot;
  const config = getConfig();
  _bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, telegramBotConstructorOptions());
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
  fraudRadar?: {
    isLikelyFractioned: boolean;
    isLikelyDirected: boolean;
    evidence: string;
  };
  audioSummary?: string;
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
      payload?.fraudRadar?.isLikelyDirected || payload?.fraudRadar?.isLikelyFractioned 
        ? `🚨 <b>FRAUD RADAR:</b> ${escapeHtml(safeText(payload?.fraudRadar?.evidence, "Se detectaron anomalías."))}\n`
        : "",
      `🎙 <b>RESUMEN RÁPIDO:</b> <i>${escapeHtml(safeText(payload?.audioSummary, "No disponible."))}</i>`,
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
        withTimeout(
          bot.sendMessage(config.TELEGRAM_CHAT_ID, text, {
            parse_mode: parseMode,
            disable_web_page_preview: true,
          } as TelegramBot.SendMessageOptions),
          config.TELEGRAM_SEND_TIMEOUT_MS,
          "telegram.sendMessage",
        ),
      {
        maxAttempts: config.TELEGRAM_MAX_RETRIES,
        initialDelayMs: config.TELEGRAM_INITIAL_RETRY_DELAY_MS,
        backoffMultiplier: config.TELEGRAM_RETRY_BACKOFF_MULTIPLIER,
        maxDelayMs: config.TELEGRAM_MAX_RETRY_DELAY_MS,
        shouldRetry: (error) => describeTelegramSendError(error).retryable,
        onRetry: (error, attempt, delay) => {
          const details = describeTelegramSendError(error);
          log.warn(
            {
              intento: attempt,
              total: config.TELEGRAM_MAX_RETRIES,
              delay_ms: delay,
              code: details.code,
              clasificacion: details.kind,
            },
            "⏳ Reintentando envío Telegram",
          );
        },
      },
    );
    await recordTelegramSendSuccess().catch((telemetryError) => {
      log.warn(
        { err: telemetryError },
        "No se pudo registrar telemetría de Telegram sendMessage exitoso",
      );
    });
    void writeTelegramLog({
      command: "sendMessage",
      requestPayload: { parseMode, textLength: text.length },
      responsePayload: { messageId: msg.message_id },
      status: "ok",
    }).catch((telemetryError) => {
      log.warn({ err: telemetryError }, "No se pudo escribir éxito en telegram_logs");
    });
    return msg.message_id;
  } catch (err) {
    const details = describeTelegramSendError(err);
    await recordTelegramSendFailure(err).catch((telemetryError) => {
      log.warn(
        { err: telemetryError },
        "No se pudo registrar telemetría de fallo Telegram sendMessage",
      );
    });
    log.error(
      {
        kind: details.kind,
        statusCode: details.statusCode,
        apiErrorCode: details.apiErrorCode,
        code: details.code,
        retryable: details.retryable,
        summary: details.summary,
      },
      "❌ Error enviando mensaje Telegram (agotados reintentos)",
    );
    void writeTelegramLog({
      command: "sendMessage",
      requestPayload: { parseMode, textLength: text.length },
      responsePayload: {
        kind: details.kind,
        retryable: details.retryable,
        code: details.code,
        statusCode: details.statusCode,
        apiErrorCode: details.apiErrorCode,
        summary: details.summary,
      },
      status: "error",
    }).catch((telemetryError) => {
      log.warn({ err: telemetryError }, "No se pudo escribir fallo en telegram_logs");
    });
    throw new TelegramError(formatTelegramFailureMessage(details), { ...details });
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

// ─── Formato público de licitación detectada ────────────────────────────────

function normalizePublicValue(value: string | null | undefined, fallback = "No disponible"): string {
  if (!value || value.trim().length === 0) return fallback;
  return value.trim();
}

function titleCaseLocation(value: string | null | undefined): string {
  const text = normalizePublicValue(value);
  if (text === "No disponible") return text;
  return text
    .toLocaleLowerCase("es-MX")
    .replace(/(^|\s|-)([a-záéíóúñü])/g, (match) => match.toLocaleUpperCase("es-MX"));
}

function buildPublicLocation(state: string | null, municipality: string | null): string {
  const stateText = titleCaseLocation(state);
  if (!municipality) return stateText;
  return `${titleCaseLocation(municipality)}, ${stateText}`;
}

function rawDate(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function formatPublicDate(value: string | null | undefined): string {
  if (!value) return "No disponible";
  return formatDateSafe(value);
}

function formatProcedureTypeLabel(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "No disponible";
  if (cleaned === cleaned.toLocaleUpperCase("es-MX")) {
    return cleaned
      .toLocaleLowerCase("es-MX")
      .replace(/(^|\s|-)([a-záéíóúñü])/g, (match) => match.toLocaleUpperCase("es-MX"));
  }
  return cleaned.charAt(0).toLocaleUpperCase("es-MX") + cleaned.slice(1);
}

function procedureTypeFromEnum(type: string | null | undefined): string | null {
  switch (type) {
    case "licitacion_publica":
      return "Licitación pública";
    case "invitacion_tres":
      return "Invitación a cuando menos tres personas";
    case "adjudicacion_directa":
      return "Adjudicación directa";
    case "licitacion_privada":
      return "Licitación privada";
    case "concurso":
      return "Concurso";
    case "subasta":
      return "Subasta";
    case "other":
      return "Otro tipo de procedimiento";
    default:
      return null;
  }
}

function procedureTypeFromProcedureNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleUpperCase("es-MX");
  if (/^IA[-_]/.test(normalized)) return "Invitación a cuando menos tres personas";
  if (/^LA[-_]/.test(normalized)) return "Licitación pública";
  if (/^AA[-_]/.test(normalized)) return "Adjudicación directa";
  return null;
}

function inferPublicProcedureType(p: EnrichedAlert["procurement"]): {
  bodyLabel: string;
  headerLabel: string;
  source: string;
  confidence: "high" | "medium" | "low";
} {
  const raw = p.rawJson as Record<string, unknown>;
  const explicitRaw = rawDate(raw, [
    "tipo_procedimiento",
    "tipoProcedimiento",
    "tipo_procedimiento_contratacion",
    "procedimiento",
    "tipo_contratacion",
    "tipoContratacion",
    "caracter_procedimiento",
    "carácter_procedimiento",
    "caracterProcedimiento",
    "modalidad",
    "tipo",
  ]);

  if (explicitRaw) {
    const bodyLabel = formatProcedureTypeLabel(explicitRaw);
    return {
      bodyLabel,
      headerLabel: bodyLabel.toLocaleUpperCase("es-MX"),
      source: "explicit",
      confidence: "high",
    };
  }

  const enumLabel = procedureTypeFromEnum(p.procedureType);
  if (enumLabel) {
    return {
      bodyLabel: enumLabel,
      headerLabel: enumLabel.toLocaleUpperCase("es-MX"),
      source: p.procedureTypeSource ?? "normalized_procedure_type",
      confidence: p.procedureTypeConfidence ?? "medium",
    };
  }

  const searchableText = [
    p.licitationNumber,
    p.procedureNumber,
    p.externalId,
    p.title,
    p.description,
    p.canonicalText,
  ].filter(Boolean).join(" ");
  const textNorm = normalizeText(searchableText);
  if (textNorm.includes("licitacion privada")) {
    return {
      bodyLabel: "Licitación privada",
      headerLabel: "LICITACIÓN PRIVADA",
      source: "text_inference",
      confidence: "medium",
    };
  }

  const numberLabel =
    procedureTypeFromProcedureNumber(p.licitationNumber) ??
    procedureTypeFromProcedureNumber(p.procedureNumber) ??
    procedureTypeFromProcedureNumber(p.externalId);
  if (numberLabel) {
    return {
      bodyLabel: numberLabel,
      headerLabel: numberLabel.toLocaleUpperCase("es-MX"),
      source: "procedure_number_prefix",
      confidence: "medium",
    };
  }

  return {
    bodyLabel: "No disponible",
    headerLabel: "TIPO NO DISPONIBLE",
    source: "unavailable",
    confidence: "low",
  };
}

function publicDocumentName(doc: PublicTenderDocument, index: number): string {
  if (doc.documentName?.trim()) return doc.documentName.trim();
  if (doc.documentType && doc.documentType !== "otro") {
    return doc.documentType.replace(/_/g, " ");
  }
  return `Documento ${index + 1}`;
}

function formatDocumentSection(
  documents: PublicTenderDocument[] | undefined,
  sourceUrl: string | null | undefined,
  escape: (value: string) => string,
): string[] {
  const validDocuments = (documents ?? []).filter((doc) => doc.isAvailable && doc.publicUrl);
  if (validDocuments.length === 0) {
    if (sourceUrl?.trim()) {
      return [
        "📎 Documentos / anexos:",
        "Disponibles desde la ficha original. Abrir el enlace original para consultar los anexos.",
      ];
    }
    return ["📎 Documentos / anexos: Documentos no disponibles."];
  }

  const lines = ["📎 Documentos / anexos:", ""];
  validDocuments.forEach((doc, index) => {
    lines.push(`${index + 1}. ${escape(publicDocumentName(doc, index))}:`);
    lines.push(`   ${escape(doc.publicUrl)}`);
    if (index < validDocuments.length - 1) lines.push("");
  });
  return lines;
}

function formatPublicTenderAlert(
  alert: EnrichedAlert,
  options: { escapeHtmlEntities: boolean },
): string {
  const esc = options.escapeHtmlEntities ? escapeHtml : (value: string) => value;
  const p = alert.procurement;
  const raw = p.rawJson as Record<string, unknown>;
  const dependency = normalizePublicValue(p.dependencyName, "Dependencia no disponible");
  const location = buildPublicLocation(p.state, p.municipality);
  const title = normalizePublicValue(p.title, "Objeto no disponible");
  const publicationDate =
    rawDate(raw, ["fecha_publicacion", "visibleDate"]) ?? p.publicationDate;
  const clarificationDate = rawDate(raw, [
    "fecha_aclaraciones",
    "fecha_junta_aclaraciones",
    "fecha_junta",
  ]);
  const openingDate =
    rawDate(raw, ["fecha_apertura", "fecha_presentacion_apertura"]) ?? p.openingDate;
  const detectedAt = formatDateSafe(alert.detectedAt);
  const procedureType = inferPublicProcedureType(p);
  const priorityProfile = detectPriorityAlertProfile(p);

  if (priorityProfile) {
    const lines: string[] = [
      `🚨 LICITACIÓN PRIORITARIA DETECTADA — ${esc(procedureType.bodyLabel)}`,
      "",
      `🎯 Perfil detectado: ${esc(priorityProfile.label)}`,
      "",
      `🏛 Dependencia: ${esc(dependency)}`,
      `📍 Ubicación: ${esc(location)}`,
      `📌 Título: ${esc(title)}`,
      "",
      `🧾 Tipo de procedimiento: ${esc(procedureType.bodyLabel)}`,
      `📅 Publicación: ${esc(formatPublicDate(publicationDate))}`,
      `⏰ Apertura: ${esc(formatPublicDate(openingDate))}`,
      "",
      "🔗 Enlace original:",
      esc(p.sourceUrl),
      "",
      ...formatDocumentSection(alert.publicDocuments, p.sourceUrl, esc),
      "",
      `⏱ Detectado: ${esc(detectedAt)}`,
    ];

    return truncateForTelegram(lines.join("\n"));
  }

  const lines: string[] = [
    `🔔 NUEVA LICITACIÓN DETECTADA — ${esc(procedureType.headerLabel)}`,
    `🏛 ${esc(dependency)} — ${esc(location)}`,
    `📌 ${esc(title)}`,
    "",
    `🏷 Tipo de procedimiento: ${esc(procedureType.bodyLabel)}`,
    `🏛 Dependencia: ${esc(dependency)}`,
    `📍 Ubicación: ${esc(location)}`,
    `📊 Estatus: ${esc(p.status)}`,
    `🔢 Licitación: ${esc(p.licitationNumber ?? p.procedureNumber ?? "No disponible")}`,
    `📋 Expediente: ${esc(p.expedienteId ?? "No disponible")}`,
    `📅 Publicación: ${esc(formatPublicDate(publicationDate))}`,
    `🗣 Junta de aclaraciones: ${esc(formatPublicDate(clarificationDate))}`,
    `📂 Apertura: ${esc(formatPublicDate(openingDate))}`,
    "",
    "🔗 Ver licitación original:",
    esc(p.sourceUrl),
    "",
    ...formatDocumentSection(alert.publicDocuments, p.sourceUrl, esc),
    "",
    `⏱ Detectado: ${esc(detectedAt)}`,
  ];

  return truncateForTelegram(lines.join("\n"));
}

/**
 * Construye el mensaje HTML para alerta de nuevo match.
 */
export function formatMatchAlert(alert: EnrichedAlert): string {
  return formatPublicTenderAlert(alert, { escapeHtmlEntities: true });
}

export function formatWhatsAppMatchAlert(alert: EnrichedAlert): string {
  return formatPublicTenderAlert(alert, { escapeHtmlEntities: false });
}

/**
 * Formatea alerta de cambio de estatus.
 */
export function formatStatusChangeAlert(
  alert: EnrichedAlert,
  previousStatus: string,
): string {
  const p = alert.procurement;
  const dependency = normalizePublicValue(p.dependencyName, "Dependencia no disponible");
  const location = buildPublicLocation(p.state, p.municipality);

  const lines: string[] = [
    `🔄 CAMBIO DE ESTATUS — ${escapeHtml(dependency)} — ${escapeHtml(location)}`,
    "",
    `📌 ${escapeHtml(p.title ?? "")}`,
    "",
    `🏛 Dependencia: ${escapeHtml(dependency)}`,
    `📍 Ubicación: ${escapeHtml(location)}`,
    `🔢 Licitación: ${escapeHtml(p.licitationNumber ?? p.procedureNumber ?? "No disponible")}`,
    `📋 Expediente: ${escapeHtml(p.expedienteId ?? "No disponible")}`,
    "",
    `📊 Estatus anterior: ${escapeHtml(previousStatus)}`,
    `📊 Estatus nuevo: ${escapeHtml(p.status)}`,
    "",
    "🔗 Ver licitación original:",
    escapeHtml(p.sourceUrl),
    "",
    `⏱ Detectado: ${escapeHtml(formatMexicoDate(alert.detectedAt))}`,
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

/**
 * Formatea el resumen diario mejorado con secciones por categoría.
 */
export function formatEnhancedDailySummaryMessage(data: SummaryData): string {
  const config = getConfig();
  const maxItems = config.DAILY_SUMMARY_MAX_ITEMS;

  const fmtShortDate = (d: string | null): string => {
    if (!d) return '?';
    try {
      return formatMexicoDate(d, 'dd/MM');
    } catch {
      return d.slice(0, 10);
    }
  };

  const fmtSection = (items: typeof data.newActive, max = 5): string => {
    return items
      .slice(0, max)
      .map((s, i) => {
        const dep = s.dependencyName ? escapeHtml(s.dependencyName.slice(0, 30)) : 'N/D';
        const date = fmtShortDate(s.openingDate);
        const title = escapeHtml(s.title.slice(0, 50));
        return `  ${i + 1}. ${title} — ${dep} — apertura ${date}`;
      })
      .join('\n');
  };

  const topItems = [
    ...data.recentDesierta,
    ...data.newActive,
    ...data.soonExpiring,
    ...data.highScore,
  ]
    .filter((s, i, arr) => arr.findIndex((x) => x.externalId === s.externalId) === i)
    .slice(0, maxItems);

  const lines: string[] = [
    `📊 <b>RESUMEN RADAR — ${escapeHtml(data.summaryDate)}</b>`,
    `<i>Radar Licitaciones MX</i>`,
    '',
    `✅ <b>Nuevas vigentes detectadas hoy:</b> ${data.newActive.length}`,
    `🏜 <b>Desiertas recientes:</b> ${data.recentDesierta.length}`,
    `⏳ <b>Próximas a vencer (≤5 días):</b> ${data.soonExpiring.length}`,
    `🔥 <b>Alto score (≥70%):</b> ${data.highScore.length}`,
    `🗑 <b>Excluidas viejas/cerradas:</b> ${data.excludedCount}`,
    '',
  ];

  if (topItems.length > 0) {
    lines.push('<b>🏆 Top oportunidades:</b>');
    lines.push(fmtSection(topItems, Math.min(10, maxItems)));
    lines.push('');
  }

  if (data.technicalIncidents.length > 0) {
    lines.push('<b>⚠️ Incidencias:</b>');
    data.technicalIncidents.forEach((inc) => lines.push(`  • ${escapeHtml(inc)}`));
    lines.push('');
  }

  return truncateForTelegram(lines.filter(Boolean).join('\n'));
}

export async function sendEnhancedDailySummary(
  data: SummaryData,
): Promise<number | null> {
  const message = formatEnhancedDailySummaryMessage(data);
  return sendTelegramMessage(message, 'HTML');
}

// ─── Alerta enriquecida (Fase D) ──────────────────────────────────────────────

export interface EnrichedAlertData {
  procedureNumber: string;
  expedienteId: string | null;
  title: string | null;
  dependency: string | null;
  scope: string;
  documentsFound: DocumentLink[];
  documentsDownloaded: DownloadResult[];
  errors: string[];
  budgetSignal?: { hasSignals: boolean; highestAmount: number | null };
  antecedentes?: {
    compranetCount: number;
    compranetHighestAmount: number | null;
    sipotCount: number;
    ocdsCount: number;
    dofCount?: number;
  };
  ceilingEstimate?: CeilingResult;
  similarContracts?: SimilarProcedure[];
}

/**
 * Formatea el segundo mensaje Telegram con el resultado del enriquecimiento OSINT.
 * Si supera 4096 chars, trunca. Si no hay documentos, envía mensaje corto.
 */
const MAX_ERRORS_SHOWN = 3;

export function formatEnrichedAlert(data: EnrichedAlertData): string {
  const procedureNumber = escapeHtml(data.procedureNumber);
  const expedienteId = escapeHtml(data.expedienteId ?? "N/D");
  const title = escapeHtml(data.title ?? "N/D");
  const dependency = escapeHtml(data.dependency ?? "N/D");
  const scope = escapeHtml(data.scope);

  // Mensaje corto si no hay documentos
  if (data.documentsFound.length === 0) {
    const lines = [
      "📁 <b>EXPEDIENTE ENRIQUECIDO</b>",
      "",
      `🔢 <b>Licitación:</b> ${procedureNumber}`,
      `🏛 <b>Dependencia:</b> ${dependency}`,
      `🌎 <b>Alcance:</b> ${scope}`,
      "",
      "📄 <b>Estado:</b> sin documentos públicos disponibles aún.",
    ];

    if (data.budgetSignal !== undefined) {
      lines.push("");
      if (data.budgetSignal.hasSignals && data.budgetSignal.highestAmount !== null) {
        lines.push(`💰 <b>Techo presupuestal detectado:</b> ${formatCurrency(data.budgetSignal.highestAmount, "MXN")}`);
      } else {
        lines.push("📊 <b>Techo presupuestal:</b> No localizado");
      }
    }

    if (data.antecedentes !== undefined) {
      const a = data.antecedentes;
      const total = a.compranetCount + a.sipotCount + a.ocdsCount + (a.dofCount ?? 0);
      lines.push("");
      if (total === 0) {
        lines.push("🔎 <b>Antecedentes:</b> Sin antecedentes directos en fuentes públicas consultadas.");
      } else {
        lines.push("🔎 <b>Antecedentes encontrados:</b>");
        const compranetSuffix =
          a.compranetCount > 0 && a.compranetHighestAmount !== null
            ? ` — mayor: ${formatCurrency(a.compranetHighestAmount, "MXN")}`
            : "";
        lines.push(`  • CompraNet: ${a.compranetCount} contratos${compranetSuffix}`);
        lines.push(`  • SIPOT/PNT: ${a.sipotCount} registros`);
        lines.push(`  • OCDS: ${a.ocdsCount} registros`);
        lines.push(`  • DOF/SIDOF: ${a.dofCount ?? 0} publicaciones`);
      }
    }

    if (data.ceilingEstimate !== undefined) {
      const ce = data.ceilingEstimate;
      lines.push("");
      lines.push("📈 <b>Estimación presupuestal:</b>");
      if (ce.directCeiling !== null && ce.directCeiling > 0) {
        lines.push(`  💰 Techo directo: ${formatCurrency(ce.directCeiling, "MXN")} (Alta confianza)`);
      } else if (ce.estimatedMin !== null && ce.estimatedMax !== null) {
        lines.push(`  📊 Rango estimado: ${formatCurrency(ce.estimatedMin, "MXN")} — ${formatCurrency(ce.estimatedMax, "MXN")}`);
        if (ce.average !== null) {
          lines.push(`  📊 Promedio histórico: ${formatCurrency(ce.average, "MXN")}`);
        }
        const confLabel = ce.confidence === "alta" ? "Alta" : ce.confidence === "media" ? "Media" : "Baja";
        lines.push(`  🎯 Confianza: ${confLabel}`);
      } else {
        lines.push("  Sin estimación disponible.");
      }
    }

    if (data.similarContracts !== undefined) {
      const sim = data.similarContracts;
      lines.push("");
      lines.push(`🔗 <b>Contratos similares (${sim.length}):</b>`);
      if (sim.length === 0) {
        lines.push("  Sin contratos similares encontrados.");
      } else {
        for (const s of sim.slice(0, 3)) {
          const t = (s.title ?? "Sin título").slice(0, 60);
          const amt =
            s.awardedAmount !== null && s.awardedAmount > 0
              ? formatCurrency(s.awardedAmount, "MXN")
              : "N/D";
          const yr = s.year !== null ? String(s.year) : "N/D";
          lines.push(`  • ${escapeHtml(t)} — ${amt} (${yr}) [${s.source}]`);
        }
      }
    }

    if (data.ceilingEstimate !== undefined || data.similarContracts !== undefined) {
      lines.push("");
      lines.push(
        `⚖️ <i>${escapeHtml(
          data.ceilingEstimate?.legalWarning ??
            "Estimación basada únicamente en información pública.",
        )}</i>`,
      );
    }

    if (data.errors.length > 0) {
      lines.push("");
      lines.push("⚠️ <b>Errores controlados:</b>");
      data.errors.slice(0, MAX_ERRORS_SHOWN).forEach((e) => lines.push(`  • ${escapeHtml(e)}`));
    }

    lines.push("");
    lines.push("⚖️ <i>Análisis basado únicamente en información pública.</i>");
    return truncateForTelegram(lines.join("\n"));
  }

  // Construir líneas de documentos
  const downloadedUrls = new Set(
    data.documentsDownloaded
      .filter((r) => r.downloadStatus === "ok" || r.downloadStatus === "skipped_duplicate")
      .map((r) => r.fileUrl),
  );

  const docLines = data.documentsFound.map((doc) => {
    const icon = downloadedUrls.has(doc.fileUrl) ? "✅" : "⚠️";
    return `  ${icon} ${escapeHtml(doc.documentTitle)}`;
  });

  const downloadedCount = data.documentsDownloaded.filter(
    (r) => r.downloadStatus === "ok" || r.downloadStatus === "skipped_duplicate",
  ).length;

  const analysisStatus =
    downloadedCount > 0
      ? "Expediente revisado parcialmente."
      : "Ningún documento pudo ser descargado.";

  const lines: string[] = [
    "📁 <b>EXPEDIENTE ENRIQUECIDO</b>",
    "",
    `🔢 <b>Licitación:</b> ${procedureNumber}`,
    `📋 <b>Expediente:</b> ${expedienteId}`,
    `📌 <b>Objeto:</b> ${title}`,
    `🏛 <b>Dependencia:</b> ${dependency}`,
    `🌎 <b>Alcance:</b> ${scope}`,
    "",
    `📄 <b>Documentos encontrados (${data.documentsFound.length}):</b>`,
    ...docLines,
    "",
    `📊 <b>Estado del análisis:</b> ${escapeHtml(analysisStatus)}`,
  ];

  if (data.budgetSignal !== undefined) {
    lines.push("");
    if (data.budgetSignal.hasSignals && data.budgetSignal.highestAmount !== null) {
      lines.push(`💰 <b>Techo presupuestal detectado:</b> ${formatCurrency(data.budgetSignal.highestAmount, "MXN")}`);
    } else {
      lines.push("📊 <b>Techo presupuestal:</b> No localizado");
    }
  }

  if (data.antecedentes !== undefined) {
    const a = data.antecedentes;
    const total = a.compranetCount + a.sipotCount + a.ocdsCount + (a.dofCount ?? 0);
    lines.push("");
    if (total === 0) {
      lines.push("🔎 <b>Antecedentes:</b> Sin antecedentes directos en fuentes públicas consultadas.");
    } else {
      lines.push("🔎 <b>Antecedentes encontrados:</b>");
      const compranetSuffix =
        a.compranetCount > 0 && a.compranetHighestAmount !== null
          ? ` — mayor: ${formatCurrency(a.compranetHighestAmount, "MXN")}`
          : "";
      lines.push(`  • CompraNet: ${a.compranetCount} contratos${compranetSuffix}`);
      lines.push(`  • SIPOT/PNT: ${a.sipotCount} registros`);
      lines.push(`  • OCDS: ${a.ocdsCount} registros`);
      lines.push(`  • DOF/SIDOF: ${a.dofCount ?? 0} publicaciones`);
    }
  }

  if (data.ceilingEstimate !== undefined) {
    const ce = data.ceilingEstimate;
    lines.push("");
    lines.push("📈 <b>Estimación presupuestal:</b>");
    if (ce.directCeiling !== null && ce.directCeiling > 0) {
      lines.push(`  💰 Techo directo: ${formatCurrency(ce.directCeiling, "MXN")} (Alta confianza)`);
    } else if (ce.estimatedMin !== null && ce.estimatedMax !== null) {
      lines.push(`  📊 Rango estimado: ${formatCurrency(ce.estimatedMin, "MXN")} — ${formatCurrency(ce.estimatedMax, "MXN")}`);
      if (ce.average !== null) {
        lines.push(`  📊 Promedio histórico: ${formatCurrency(ce.average, "MXN")}`);
      }
      const confLabel = ce.confidence === "alta" ? "Alta" : ce.confidence === "media" ? "Media" : "Baja";
      lines.push(`  🎯 Confianza: ${confLabel}`);
    } else {
      lines.push("  Sin estimación disponible.");
    }
  }

  if (data.similarContracts !== undefined) {
    const sim = data.similarContracts;
    lines.push("");
    lines.push(`🔗 <b>Contratos similares (${sim.length}):</b>`);
    if (sim.length === 0) {
      lines.push("  Sin contratos similares encontrados.");
    } else {
      for (const s of sim.slice(0, 3)) {
        const t = (s.title ?? "Sin título").slice(0, 60);
        const amt =
          s.awardedAmount !== null && s.awardedAmount > 0
            ? formatCurrency(s.awardedAmount, "MXN")
            : "N/D";
        const yr = s.year !== null ? String(s.year) : "N/D";
        lines.push(`  • ${escapeHtml(t)} — ${amt} (${yr}) [${s.source}]`);
      }
    }
  }

  if (data.ceilingEstimate !== undefined || data.similarContracts !== undefined) {
    lines.push("");
    lines.push(
      `⚖️ <i>${escapeHtml(
        data.ceilingEstimate?.legalWarning ??
          "Estimación basada únicamente en información pública.",
      )}</i>`,
    );
  }

  if (data.errors.length > 0) {
    lines.push("");
    lines.push("⚠️ <b>Errores controlados:</b>");
    data.errors.slice(0, 3).forEach((e) => lines.push(`  • ${escapeHtml(e)}`));
  }

  lines.push("");
  lines.push("⚖️ <i>Análisis basado únicamente en información pública.</i>");

  return truncateForTelegram(lines.join("\n"));
}
