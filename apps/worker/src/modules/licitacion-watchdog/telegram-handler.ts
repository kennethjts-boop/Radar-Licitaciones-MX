import type TelegramBot from "node-telegram-bot-api";
import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import { formatMexicoDate } from "../../core/time";
import { getState, STATE_KEYS } from "../../core/system-state";
import { getLastChangedSnapshot, getLatestSnapshot } from "./repository";
import type { WatchdogTelemetry } from "./types";

const log = createModuleLogger("licitacion-watchdog:telegram");

function escapeHtml(value: unknown): string {
  return String(value ?? "N/D").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function handleWatchdogCommand(bot: TelegramBot, chatId: string): Promise<void> {
  try {
    const expedientes = getConfig().WATCHDOG_EXPEDIENTES.split(",").map((value) => value.trim()).filter(Boolean);
    const telemetry = await getState<WatchdogTelemetry>(STATE_KEYS.WATCHDOG_TELEMETRY);
    const lines = [
      "🐕 <b>Estado del watchdog</b>",
      `Estado: <b>${escapeHtml(telemetry?.status ?? "sin ejecución")}</b>`,
      `Última verificación: <b>${escapeHtml(formatMexicoDate(telemetry?.lastCheckedAt, "dd/MM/yyyy HH:mm"))} CDMX</b>`,
      "",
    ];
    for (const numero of expedientes) {
      const [latest, lastChange] = await Promise.all([
        getLatestSnapshot(numero),
        getLastChangedSnapshot(numero),
      ]);
      lines.push(
        `• <code>${escapeHtml(numero)}</code>`,
        `  Último snapshot: <b>${escapeHtml(latest ? formatMexicoDate(latest.created_at, "dd/MM/yyyy HH:mm") : "sin baseline")}</b>`,
        `  Último cambio: <b>${escapeHtml(lastChange ? formatMexicoDate(lastChange.created_at, "dd/MM/yyyy HH:mm") : "ninguno")}</b>`,
      );
    }
    await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "HTML", disable_web_page_preview: true }).catch(() => {});
  } catch (err) {
    log.error({ err }, "Error contenido en /watchdog");
    await bot.sendMessage(chatId, "⚠️ No pude consultar el estado del watchdog; revisar logs.").catch(() => {});
  }
}
