/** Callbacks autorizados, comando /calendario y botones sobre alertas ya enviadas. */
import type TelegramBot from "node-telegram-bot-api";
import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import { getSupabaseClient } from "../../storage/client";
import { isAuthorizedChatUser } from "../licitacion-watchdog/consent";
import { calendarKeyboard } from "./keyboard";
import { esc } from "./format";
import {
  CALENDAR_BUTTON_RADAR_KEYS, defaultDeps, disableTracking, enableTracking, getCalendarView, isTracking,
  type CalendarDeps,
} from "./service";
import * as store from "./store";
import { isWatchedProcedure } from "../priority-watch/types";

const log = createModuleLogger("procurement-calendar:telegram");
const ID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

const sendOptions = (extra: Partial<TelegramBot.SendMessageOptions> = {}): TelegramBot.SendMessageOptions =>
  ({ parse_mode: "HTML", disable_web_page_preview: true, ...extra });

export async function handleCalendarCallback(
  bot: TelegramBot, query: TelegramBot.CallbackQuery, deps: CalendarDeps = defaultDeps,
): Promise<boolean> {
  const view = query.data?.match(new RegExp(`^cal:(${ID})$`));
  const track = query.data?.match(new RegExp(`^trk:(on|off):(${ID})$`));
  if (!view && !track) return false;
  const chatId = String(query.message?.chat.id ?? "");
  try {
    if (!isAuthorizedChatUser(chatId, query.from.id)) {
      await bot.answerCallbackQuery(query.id, { text: "No autorizado" });
      return true;
    }
    if (view) {
      await bot.answerCallbackQuery(query.id, { text: "Consultando calendario…" });
      const result = await getCalendarView(view[1], deps);
      if (!result) {
        await bot.sendMessage(chatId, "⚠️ No encontré ese expediente en el radar.");
        return true;
      }
      await bot.sendMessage(chatId, result.text, sendOptions({
        reply_to_message_id: query.message?.message_id, reply_markup: calendarKeyboard(result.info.id, result.tracking),
      }));
      return true;
    }
    const [, action, id] = track!;
    if (action === "on") {
      const enabled = await enableTracking(id, chatId, query.from.id, deps);
      if (!enabled) {
        await bot.answerCallbackQuery(query.id, { text: "Expediente no encontrado" });
        return true;
      }
      await bot.answerCallbackQuery(query.id, { text: "🔔 Seguimiento activado" });
      await refreshKeyboard(bot, query, id, true);
      await bot.sendMessage(chatId,
        `🔔 <b>Seguimiento activado</b>: ${esc(enabled.info.expediente)}\nTe aviso una sola vez por cada fecha nueva o modificada, aviso oficial o acta de fallo.` +
        (enabled.baselineFrom === "guardado" ? "\nℹ️ El portal no respondió; tomé como base el último calendario guardado." : "") +
        "\nPuedes desactivarlo con «Dejar de avisar».", sendOptions());
    } else {
      const target = await deps.loadProcurement(id);
      if (target && isWatchedProcedure(target.expediente)) {
        // Vigilancia prioritaria: política del radar, no se silencia desde el botón.
        await bot.answerCallbackQuery(query.id, { text: "Este expediente tiene vigilancia prioritaria; se mantiene activa." });
        return true;
      }
      const disabled = await disableTracking(id, deps);
      await bot.answerCallbackQuery(query.id, { text: disabled ? "🔕 Seguimiento desactivado" : "Expediente no encontrado" });
      if (disabled) {
        await refreshKeyboard(bot, query, id, false);
        await bot.sendMessage(chatId, `🔕 <b>Seguimiento desactivado</b>: ${esc(disabled.expediente)}`, sendOptions());
      }
    }
  } catch (err) {
    log.warn({ err }, "No se pudo procesar el botón de calendario");
    await bot.answerCallbackQuery(query.id, { text: "No pude completar la operación; vuelve a pulsar." }).catch(() => undefined);
  }
  return true;
}

async function refreshKeyboard(bot: TelegramBot, query: TelegramBot.CallbackQuery, id: string, tracking: boolean): Promise<void> {
  if (!query.message) return;
  await bot.editMessageReplyMarkup(calendarKeyboard(id, tracking), {
    chat_id: query.message.chat.id, message_id: query.message.message_id,
  }).catch((err) => log.warn({ err }, "No se pudo actualizar el teclado del mensaje"));
}

/** Consulta por número de expediente: alternativa cuando el mensaje ya no admite botones. */
export async function handleCalendarCommand(
  bot: TelegramBot, msg: TelegramBot.Message, expediente: string | undefined, deps: CalendarDeps = defaultDeps,
): Promise<void> {
  const chatId = String(msg.chat.id);
  if (!isAuthorizedChatUser(chatId, msg.from?.id)) return;
  const input = expediente?.trim();
  if (!input) {
    await bot.sendMessage(chatId, "📅 Uso: <code>/calendario LA-12-NEF-012NEF001-N-3-2027</code>", sendOptions());
    return;
  }
  try {
    const result = await getCalendarView(input, deps);
    if (!result) {
      await bot.sendMessage(chatId, `⚠️ No encontré el expediente <code>${esc(input)}</code> en el radar.`, sendOptions());
      return;
    }
    await bot.sendMessage(chatId, result.text, sendOptions({ reply_markup: calendarKeyboard(result.info.id, result.tracking) }));
  } catch (err) {
    log.warn({ err }, "No se pudo responder /calendario");
    await bot.sendMessage(chatId, "⚠️ No pude consultar el calendario; intenta de nuevo.").catch(() => undefined);
  }
}

export interface ButtonReconcileResult { checked: number; attached: number; failed: number }

/**
 * Agrega los botones a alertas ya enviadas (p. ej. el mensaje 3905 de BIRMEX).
 * Si Telegram ya no permite editar el mensaje, deja una consulta por número.
 */
export async function attachCalendarButtonsToSentAlerts(
  bot: TelegramBot, options: { max?: number; deps?: CalendarDeps } = {},
): Promise<ButtonReconcileResult> {
  const deps = options.deps ?? defaultDeps;
  const result: ButtonReconcileResult = { checked: 0, attached: 0, failed: 0 };
  const { data, error } = await getSupabaseClient().from("alerts")
    .select("procurement_id, telegram_message_id, radars!inner(key), procurements!inner(licitation_number, procedure_number)")
    .eq("alert_type", "new_match").eq("telegram_status", "sent").not("telegram_message_id", "is", null)
    .in("radars.key", [...CALENDAR_BUTTON_RADAR_KEYS]).order("sent_at", { ascending: false }).limit(50);
  if (error) throw new Error(`Botones de calendario: ${error.message}`);
  const chatId = getConfig().TELEGRAM_CHAT_ID;
  for (const row of data ?? []) {
    if (result.attached + result.failed >= (options.max ?? 5)) break;
    const procurementId = String(row.procurement_id);
    result.checked++;
    if (await store.getButtons(procurementId)) continue;
    const messageId = Number(row.telegram_message_id);
    try {
      await bot.editMessageReplyMarkup(calendarKeyboard(procurementId, await isTracking(procurementId, deps)), {
        chat_id: chatId, message_id: messageId,
      });
      await store.saveButtons(procurementId, { messageId, attachedAt: new Date().toISOString(), ok: true });
      result.attached++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.saveButtons(procurementId, { messageId, attachedAt: new Date().toISOString(), ok: false, error: message.slice(0, 200) });
      result.failed++;
      const procurement = Array.isArray(row.procurements) ? row.procurements[0] : row.procurements;
      const number = procurement?.licitation_number ?? procurement?.procedure_number ?? procurementId;
      await bot.sendMessage(chatId,
        `📅 No pude agregar botones al mensaje ${messageId}. Consulta el calendario con <code>/calendario ${esc(String(number))}</code>`,
        sendOptions()).catch(() => undefined);
    }
  }
  return result;
}
