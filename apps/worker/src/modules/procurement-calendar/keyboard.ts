/** Botones de las alertas de licitación (callbacks cal:/trk:). */
import type TelegramBot from "node-telegram-bot-api";

export function calendarKeyboard(procurementId: string, tracking: boolean): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: "📅 Ver calendario", callback_data: `cal:${procurementId}` },
      tracking
        ? { text: "🔕 Dejar de avisar", callback_data: `trk:off:${procurementId}` }
        : { text: "🔔 Avisarme de cambios", callback_data: `trk:on:${procurementId}` },
    ]],
  };
}
