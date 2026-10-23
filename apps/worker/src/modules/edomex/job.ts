import axios from "axios";
import { createHash } from "crypto";
import type TelegramBot from "node-telegram-bot-api";
import { getSupabaseClient } from "../../storage/client";
import { getCommandBot } from "../../agent/telegram.commands";
import { getConfig } from "../../config/env";
import { withDistributedLock } from "../../core/lock";
import { createModuleLogger } from "../../core/logger";
import { isAuthorizedAdmin } from "../control/authorization";
import { EDOMEX_PAGES, parseEdomexPage, noticeMessage, escapeHtml, type EdomexNotice } from "./policy";

const log = createModuleLogger("edomex");
const PREFIX = "edomex_notice:";
interface Entry extends EdomexNotice {
  detectedAt: string;
  consent: "pending" | "approved" | "declined";
  messageId: number | null;
  chatId: string;
  pdfHash?: string;
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

/** Lectura pública, sin navegador, cookies, IA ni descarga de documentos no autorizados. */
export async function fetchIndex(url: string): Promise<string> {
  if (!(EDOMEX_PAGES as readonly string[]).includes(url)) throw new Error("Índice no permitido");
  const response = await axios.get<string>(url, { timeout: 25_000, maxRedirects: 0,
    maxContentLength: 5_000_000, responseType: "text" });
  return response.data;
}

async function pdfHash(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "portal.secogem.gob.mx") throw new Error("PDF no permitido");
  const response = await axios.get<ArrayBuffer>(url, { timeout: 25_000, maxRedirects: 0,
    maxContentLength: 12_000_000, responseType: "arraybuffer" });
  const body = Buffer.from(response.data);
  if (!body.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("La respuesta no es un PDF");
  return createHash("sha256").update(body).digest("hex");
}

async function notifyPending(entry: Entry, bot: TelegramBot): Promise<boolean> {
  if (entry.messageId || entry.consent !== "pending") return false;
  const message = await bot.sendMessage(entry.chatId, noticeMessage(entry), {
    parse_mode: "HTML", disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[
      { text: "✅ Sí, vigilar PDF", callback_data: `edw:yes:${entry.id}` },
      { text: "❌ No vigilar", callback_data: `edw:no:${entry.id}` },
    ]] },
  });
  await write(PREFIX + entry.id, { ...entry, messageId: message.message_id });
  await write(`edomex_reply:${entry.chatId}:${message.message_id}`, { id: entry.id });
  return true;
}

/** El primer arranque guarda una línea base: nunca llama "nuevas" a las filas históricas. */
export async function runEdomexJob(options: { discover?: boolean; watch?: boolean } = {}): Promise<void> {
  await withDistributedLock("edomex", "edomex-indexes", async () => {
    const bot = getCommandBot();
    if (!bot) return;
    let alerted = 0;
    if (options.discover !== false) for (const page of EDOMEX_PAGES) {
      try {
        const parsed = parseEdomexPage(await fetchIndex(page));
        const baselineKey = `edomex_index:${page.split("/").pop()}`;
        const previous = await read<{ ids: string[] }>(baselineKey);
        const known = new Set(previous?.ids ?? []);
        if (previous) for (const notice of parsed.notices) {
          if (known.has(notice.id)) continue;
          if (!(await read<Entry>(PREFIX + notice.id))) await write(PREFIX + notice.id, {
            ...notice, detectedAt: new Date().toISOString(), consent: "pending", messageId: null,
            chatId: getConfig().TELEGRAM_CHAT_ID,
          } satisfies Entry);
        }
        // Sólo avanzar después de persistir toda la cola. Fallos de envío se reintentan.
        await write(baselineKey, { ids: [...new Set([...known, ...parsed.allIds])], checkedAt: new Date().toISOString() });
      } catch (err) { log.warn({ err, page }, "Índice Edomex no procesado; se conserva la línea base"); }
    }

    const { data, error } = await getSupabaseClient().from("system_state")
      .select("key,value_json").like("key", `${PREFIX}%`);
    if (error) throw new Error(`Edomex cola: ${error.message}`);
    for (const row of data ?? []) {
      const entry = row.value_json as Entry;
      try {
        if (options.discover !== false && alerted < 5 && await notifyPending(entry, bot)) alerted++;
        if (options.watch === false || entry.consent !== "approved") continue;
        // El mismo lock protege callbacks y vigilancia contra decisiones concurrentes.
        await withDistributedLock(`edomex-consent:${entry.id}`, entry.id, async () => {
          const current = await read<Entry>(PREFIX + entry.id);
          if (current?.consent !== "approved") return;
          const hash = await pdfHash(current.url);
          if (current.pdfHash && current.pdfHash !== hash) await bot.sendMessage(current.chatId,
            `🔔 <b>Cambió la convocatoria EDOMEX</b>\n${escapeHtml(current.number)}\n<a href="${escapeHtml(current.url)}">Revisar PDF oficial</a>`,
            { parse_mode: "HTML", reply_markup: { inline_keyboard: [[
              { text: "⏹ Dejar de vigilar", callback_data: `edw:stop:${entry.id}` },
            ]] } });
          if (hash !== current.pdfHash) await write(PREFIX + entry.id, { ...current, pdfHash: hash });
        });
      } catch (err) { log.warn({ err, id: entry.id }, "Edomex: operación pendiente para el siguiente ciclo"); }
    }
    await write("edomex_last_run", { at: new Date().toISOString(), alerted });
  });
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
  await withDistributedLock(`edomex-consent:${id}`, id, async () => {
    const entry = await read<Entry>(PREFIX + id);
    if (!entry || entry.chatId !== chatId) return;
    if (action !== "stop" && entry.messageId !== messageId) return;
    if (action !== "stop" && entry.consent !== "pending") { result = "Esta solicitud ya fue respondida"; return; }
    if (action === "stop" && entry.consent !== "approved") { result = "La vigilancia ya está detenida"; return; }
    await write(PREFIX + id, { ...entry, consent: action === "yes" ? "approved" : "declined",
      decidedAt: new Date().toISOString(), decidedBy: userId });
    result = action === "yes" ? "Vigilancia del PDF autorizada" : "No se vigilará el PDF";
    await bot.editMessageReplyMarkup({ inline_keyboard: action === "yes"
      ? [[{ text: "⏹ Dejar de vigilar", callback_data: `edw:stop:${id}` }]] : [] },
    { chat_id: chatId, message_id: messageId }).catch(() => {});
  });
  return result;
}

export async function handleEdomexCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery): Promise<void> {
  const match = query.data?.match(/^edw:(yes|no|stop):([a-f0-9]{24})$/);
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
  const answer = message.text?.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!message.reply_to_message || !/^(si|no)$/.test(answer ?? "")) return;
  const chatId = String(message.chat.id);
  if (!authorized(chatId, message.from?.id)) return;
  const ref = await read<{ id: string }>(`edomex_reply:${chatId}:${message.reply_to_message.message_id}`);
  if (!ref) return;
  const result = await decideEdomexConsent(ref.id, chatId, message.from?.id,
    message.reply_to_message.message_id, answer === "si" ? "yes" : "no", bot);
  await bot.sendMessage(chatId, result);
}
