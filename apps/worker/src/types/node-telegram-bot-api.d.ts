import "node-telegram-bot-api";

declare module "node-telegram-bot-api" {
  /**
   * node-telegram-bot-api acepta estas opciones en runtime desde v0.30,
   * pero @types/node-telegram-bot-api todavía declara deleteWebHook() sin parámetros.
   */
  interface DeleteWebHookOptions {
    drop_pending_updates?: boolean;
  }
}
