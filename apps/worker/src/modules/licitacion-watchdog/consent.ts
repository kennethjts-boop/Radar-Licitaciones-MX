import type TelegramBot from "node-telegram-bot-api";
import { getConfig } from "../../config/env";
import { nowISO } from "../../core/time";
import { createModuleLogger } from "../../core/logger";
import { getCommandBot } from "../../agent/telegram.commands";
import { isAuthorizedAdmin } from "../control/authorization";
import { activateWatchdogTarget, listPersistentTargets } from "./target-manager";
import {
  getWatchdogConsent, createWatchdogConsent, updatePendingConsent, consentForReply,
  type WatchdogConsent,
} from "./consent-store";

const log = createModuleLogger("watchdog:consent");
const inFlight = new Map<string, Promise<boolean>>();
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Repara un alta interrumpida sólo si ya existe un Sí persistido. */
export async function activateApprovedConsent(consent: WatchdogConsent): Promise<boolean> {
  if (consent.status !== "approved" || !consent.decidedAt) return false;
  const targets = await listPersistentTargets(false);
  if (!targets) throw new Error("No existe watchdog_targets");
  const target = targets.find((item) => item.procurementId === consent.procurementId);
  if (target?.active || (target?.deactivatedAt && target.deactivatedAt >= consent.decidedAt)) return false;
  await activateWatchdogTarget(consent.procurementId);
  return true;
}

export async function requestWatchdogConsent(procurementId: string, label: string): Promise<boolean> {
  const running = inFlight.get(procurementId);
  if (running) return running;
  const task = (async () => {
    const bot = getCommandBot();
    if (!bot) return false; // Reconciliación reintenta cuando el bot esté listo.
    const chatId = getConfig().TELEGRAM_CHAT_ID;
    await createWatchdogConsent({ procurementId, label, status: "pending", chatId });
    const consent = await getWatchdogConsent(procurementId);
    if (!consent || consent.status !== "pending" || consent.messageId) return false;
    const message = await bot.sendMessage(chatId,
      `🐕 <b>¿Vigilar esta licitación?</b>\n${escapeHtml(label)}\n\nTe avisaré si cambian documentos, fechas o partidas.\nPulsa un botón o responde a este mensaje con <b>sí</b> o <b>no</b>.\nSin tu Sí, no se vigila.`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[
        { text: "✅ Sí, vigilar", callback_data: `wd:yes:${procurementId}` },
        { text: "❌ No vigilar", callback_data: `wd:no:${procurementId}` },
      ]] } });
    await updatePendingConsent({ ...consent, messageId: message.message_id });
    return true;
  })();
  inFlight.set(procurementId, task);
  try { return await task; } finally { inFlight.delete(procurementId); }
}

function authorized(chatId: string, userId?: number): boolean {
  const config = getConfig();
  return chatId === config.TELEGRAM_CHAT_ID &&
    (String(userId) === chatId || isAuthorizedAdmin(userId, config.TELEGRAM_ADMIN_CHAT_IDS));
}

async function decide(bot: TelegramBot, consent: WatchdogConsent, yes: boolean, userId: number): Promise<string> {
  if (consent.status !== "pending") {
    if (consent.status === "approved") await activateApprovedConsent(consent);
    return "Esta solicitud ya fue respondida.";
  }
  const decision: WatchdogConsent = {
    ...consent, status: yes ? "approved" : "declined", decidedAt: nowISO(), decidedBy: userId,
  };
  if (!(await updatePendingConsent(decision))) return "Esta solicitud ya fue respondida.";
  if (yes) await activateApprovedConsent(decision);
  if (consent.messageId) {
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: consent.chatId, message_id: consent.messageId,
    }).catch(() => {});
  }
  const text = `${yes ? "✅ Vigilancia autorizada" : "⏹ No se vigilará"}: ${consent.label}`;
  await bot.sendMessage(consent.chatId, text);
  return yes ? "Vigilancia autorizada" : "No se vigilará";
}

export async function handleWatchdogConsentCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery): Promise<void> {
  const match = query.data?.match(/^wd:(yes|no):([a-zA-Z0-9-]+)$/);
  if (!match) return;
  try {
    const chatId = String(query.message?.chat.id ?? "");
    if (!authorized(chatId, query.from.id)) {
      await bot.answerCallbackQuery(query.id, { text: "No autorizado" });
      return;
    }
    const consent = await getWatchdogConsent(match[2]);
    if (!consent || consent.chatId !== chatId || consent.messageId !== query.message?.message_id) {
      await bot.answerCallbackQuery(query.id, { text: "Solicitud no válida" });
      return;
    }
    await bot.answerCallbackQuery(query.id, {
      text: await decide(bot, consent, match[1] === "yes", query.from.id),
    });
  } catch (err) {
    log.warn({ err }, "No se pudo procesar autorización watchdog");
    await bot.answerCallbackQuery(query.id, { text: "No pude completar la operación; vuelve a pulsar." }).catch(() => {});
  }
}

export async function handleWatchdogConsentReply(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
  const normalized = msg.text?.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!msg.reply_to_message || !/^(si|no)$/.test(normalized ?? "")) return;
  const chatId = String(msg.chat.id);
  if (!authorized(chatId, msg.from?.id)) return;
  try {
    const consent = await consentForReply(chatId, msg.reply_to_message.message_id);
    if (consent) await decide(bot, consent, normalized === "si", msg.from!.id);
  } catch (err) {
    log.warn({ err }, "No se pudo guardar respuesta watchdog");
    await bot.sendMessage(chatId, "⚠️ No pude completar tu respuesta; vuelve a responder a la solicitud.").catch(() => {});
  }
}
