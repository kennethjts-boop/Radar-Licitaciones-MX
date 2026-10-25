/**
 * Vigilancia del PDF de convocatorias SECOGEM, sólo con un Sí persistido.
 *
 * Se solicita después de entregar la alerta (auto-activation del watchdog la
 * enruta aquí cuando el procedimiento proviene de SECOGEM). Una solicitud ya
 * creada, respondida o rechazada nunca se vuelve a enviar.
 */
import axios from "axios";
import { createHash } from "crypto";
import type TelegramBot from "node-telegram-bot-api";
import { getSupabaseClient } from "../../storage/client";
import { getCommandBot } from "../../agent/telegram.commands";
import { getConfig } from "../../config/env";
import { withDistributedLock } from "../../core/lock";
import { createModuleLogger } from "../../core/logger";
import { isAuthorizedAdmin } from "../control/authorization";
import { escapeHtml } from "./policy";

const log = createModuleLogger("edomex:consent");
export const WATCH_PREFIX = "edomex_watch:";
const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export interface EdomexWatch {
  procurementId: string;
  url: string;
  label: string;
  consent: "pending" | "approved" | "declined" | "stopped";
  chatId: string;
  messageId: number | null;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: number;
  pdfHash?: string;
  lastCheckedAt?: string;
}

export function isSecogemProcurementUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "portal.secogem.gob.mx";
  } catch { return false; }
}

async function read<T>(key: string): Promise<T | null> {
  const { data, error } = await getSupabaseClient().from("system_state")
    .select("value_json").eq("key", key).maybeSingle();
  if (error) throw new Error(`Edomex lectura: ${error.message}`);
  return (data?.value_json as T) ?? null;
}
async function write(key: string, value: object): Promise<void> {
  const { error } = await getSupabaseClient().from("system_state")
    .upsert({ key, value_json: value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`Edomex persistencia: ${error.message}`);
}

export function consentPrompt(label: string): string {
  return `🐕 <b>¿Vigilar?</b> Convocatoria EDOMEX\n<code>${escapeHtml(label.slice(0, 300))}</code>\n\n` +
    "Qué puedo vigilar en esta fuente: sólo el PDF oficial de la convocatoria publicado por SECOGEM; te aviso si el archivo cambia.\n" +
    "No vigila bases, anexos, juntas de aclaraciones, actas, fallos ni registros en otros portales.\n\n" +
    "Pulsa Sí / No o responde a este mensaje <b>sí</b> o <b>no</b>. Sin tu Sí no se vigila.";
}

/** Envía una sola vez la pregunta; nunca reinsiste tras un No ni reactiva históricos. */
export async function requestEdomexPdfConsent(procurementId: string): Promise<boolean> {
  const result = await withDistributedLock(`edomex-consent:${procurementId}`, procurementId, async () => {
    const bot = getCommandBot();
    if (!bot) return false; // La conciliación del watchdog reintenta.
    const key = WATCH_PREFIX + procurementId;
    const existing = await read<EdomexWatch>(key);
    if (existing && (existing.consent !== "pending" || existing.messageId)) return false;
    const { data, error } = await getSupabaseClient().from("procurements")
      .select("id,source_url,procedure_number,raw_items(raw_json)").eq("id", procurementId).maybeSingle();
    if (error) throw new Error(`Edomex procedimiento: ${error.message}`);
    if (!data || !isSecogemProcurementUrl(data.source_url)) return false;
    const rawItem = Array.isArray(data.raw_items) ? data.raw_items[0] : data.raw_items;
    const rawJson = (rawItem as { raw_json?: Record<string, unknown> } | null)?.raw_json ?? {};
    const numbers = Array.isArray(rawJson.convocatoria_procedimientos)
      ? (rawJson.convocatoria_procedimientos as string[]).join(", ") : null;
    const entry: EdomexWatch = existing ?? {
      procurementId, url: data.source_url, label: numbers || data.procedure_number || procurementId,
      consent: "pending", chatId: getConfig().TELEGRAM_CHAT_ID, messageId: null,
      requestedAt: new Date().toISOString(),
    };
    // Persistir antes de enviar: un fallo posterior no permite vigilar sin Sí.
    if (!existing) await write(key, entry);
    const message = await bot.sendMessage(entry.chatId, consentPrompt(entry.label), {
      parse_mode: "HTML", disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[
        { text: "✅ Sí, vigilar PDF", callback_data: `edw:yes:${procurementId}` },
        { text: "❌ No", callback_data: `edw:no:${procurementId}` },
      ]] },
    });
    await write(key, { ...entry, messageId: message.message_id });
    await write(`edomex_reply:${entry.chatId}:${message.message_id}`, { id: procurementId });
    return true;
  });
  return result ?? false;
}

async function pdfHash(url: string): Promise<string> {
  if (!isSecogemProcurementUrl(url)) throw new Error("PDF no permitido");
  const response = await axios.get<ArrayBuffer>(url, { timeout: 25_000, maxRedirects: 0,
    maxContentLength: 12_000_000, responseType: "arraybuffer" });
  const body = Buffer.from(response.data);
  if (!body.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("La respuesta no es un PDF");
  return createHash("sha256").update(body).digest("hex");
}

/** Compara el PDF de las convocatorias autorizadas; la primera lectura fija la línea base. */
export async function runEdomexPdfWatch(): Promise<{ checked: number; changed: number; errors: number }> {
  const stats = { checked: 0, changed: 0, errors: 0 };
  const bot = getCommandBot();
  if (!bot) return stats;
  const { data, error } = await getSupabaseClient().from("system_state")
    .select("key,value_json").like("key", `${WATCH_PREFIX}%`);
  if (error) throw new Error(`Edomex vigilancia: ${error.message}`);
  for (const row of data ?? []) {
    const entry = row.value_json as EdomexWatch;
    if (entry.consent !== "approved") continue;
    try {
      await withDistributedLock(`edomex-consent:${entry.procurementId}`, entry.procurementId, async () => {
        const current = await read<EdomexWatch>(WATCH_PREFIX + entry.procurementId);
        if (current?.consent !== "approved") return;
        const hash = await pdfHash(current.url);
        stats.checked++;
        if (current.pdfHash && current.pdfHash !== hash) {
          stats.changed++;
          await bot.sendMessage(current.chatId,
            `🔔 <b>Cambió el PDF de la convocatoria EDOMEX</b>\n<code>${escapeHtml(current.label)}</code>\n` +
            `<a href="${escapeHtml(current.url)}">Revisar PDF oficial</a>\nSólo se compara el PDF; revisa también juntas y anexos en las bases.`,
            { parse_mode: "HTML", reply_markup: { inline_keyboard: [[
              { text: "⏹ Dejar de vigilar", callback_data: `edw:stop:${current.procurementId}` },
            ]] } });
        }
        await write(WATCH_PREFIX + entry.procurementId, { ...current, pdfHash: hash, lastCheckedAt: new Date().toISOString() });
      });
    } catch (err) {
      stats.errors++;
      log.warn({ err, procurementId: entry.procurementId }, "Edomex: comprobación de PDF pendiente para el siguiente ciclo");
    }
  }
  return stats;
}

function authorized(chatId: string, userId?: number): boolean {
  const config = getConfig();
  return chatId === config.TELEGRAM_CHAT_ID &&
    (String(userId) === chatId || isAuthorizedAdmin(userId, config.TELEGRAM_ADMIN_CHAT_IDS));
}

export async function decideEdomexConsent(id: string, chatId: string, userId: number | undefined,
  messageId: number, action: "yes" | "no" | "stop", bot: TelegramBot): Promise<string> {
  if (!authorized(chatId, userId)) return "No autorizado";
  let result = "Solicitud no válida";
  const locked = await withDistributedLock(`edomex-consent:${id}`, id, async () => {
    const entry = await read<EdomexWatch>(WATCH_PREFIX + id);
    if (!entry || entry.chatId !== chatId) return;
    if (action !== "stop" && entry.messageId !== messageId) return;
    if (action !== "stop" && entry.consent !== "pending") { result = "Esta solicitud ya fue respondida"; return; }
    if (action === "stop" && entry.consent !== "approved") { result = "La vigilancia ya está detenida"; return; }
    await write(WATCH_PREFIX + id, { ...entry,
      consent: action === "yes" ? "approved" : action === "no" ? "declined" : "stopped",
      decidedAt: new Date().toISOString(), decidedBy: userId });
    result = action === "yes" ? "Vigilancia del PDF autorizada" : action === "no" ? "No se vigilará" : "Vigilancia detenida";
    await bot.editMessageReplyMarkup({ inline_keyboard: action === "yes"
      ? [[{ text: "⏹ Dejar de vigilar", callback_data: `edw:stop:${id}` }]] : [] },
    { chat_id: chatId, message_id: messageId }).catch(() => {});
  });
  return locked === null ? "Operación en curso; vuelve a intentar" : result;
}

export async function handleEdomexCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery): Promise<void> {
  const match = query.data?.match(new RegExp(`^edw:(yes|no|stop):(${ID})$`));
  if (!match) return;
  try {
    const text = await decideEdomexConsent(match[2], String(query.message?.chat.id ?? ""), query.from.id,
      query.message?.message_id ?? 0, match[1] as "yes" | "no" | "stop", bot);
    await bot.answerCallbackQuery(query.id, { text });
  } catch (err) {
    log.warn({ err }, "No se pudo guardar consentimiento Edomex");
    await bot.answerCallbackQuery(query.id, { text: "No pude guardar la respuesta; vuelve a intentar" }).catch(() => {});
  }
}

export async function handleEdomexReply(bot: TelegramBot, message: TelegramBot.Message): Promise<void> {
  const answer = message.text?.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!message.reply_to_message || !/^(si|no)$/.test(answer ?? "")) return;
  const chatId = String(message.chat.id);
  if (!authorized(chatId, message.from?.id)) return;
  const ref = await read<{ id: string }>(`edomex_reply:${chatId}:${message.reply_to_message.message_id}`);
  if (!ref) return;
  const result = await decideEdomexConsent(ref.id, chatId, message.from?.id,
    message.reply_to_message.message_id, answer === "si" ? "yes" : "no", bot);
  await bot.sendMessage(chatId, result);
}
