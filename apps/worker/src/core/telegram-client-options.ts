import type TelegramBot from "node-telegram-bot-api";

export const TELEGRAM_HTTP_REQUEST_TIMEOUT_MS = 20_000;

export function telegramBotConstructorOptions(): TelegramBot.ConstructorOptions {
  return {
    polling: false,
    request: { timeout: TELEGRAM_HTTP_REQUEST_TIMEOUT_MS } as unknown as TelegramBot.ConstructorOptions["request"],
  };
}
