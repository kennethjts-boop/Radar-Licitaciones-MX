/**
 * TELEGRAM HANDLER — Handler aislado para el comando /techo.
 *
 * INSTRUCCIONES DE INTEGRACIÓN:
 * Para conectar al bot existente, agregar en telegram.commands.ts
 * dentro de registerCommands():
 *
 *   import { handleTechoCommand } from '../modules/financial-ceiling-radar/telegram-handler';
 *   // Luego dentro de registerCommands():
 *   bot.onText(/\/techo (.+)/, async (msg, match) => {
 *     if (String(msg.chat.id) !== chatId) return;
 *     await handleTechoCommand(bot, chatId, match?.[1]?.trim() ?? '');
 *   });
 *
 * Esta función es auto-contenida y no puede romper el bot si falla.
 */

import TelegramBot from "node-telegram-bot-api";
import { createModuleLogger } from "../../core/logger";
import { analyzeFinancialCeiling } from "./analyzer";
import { formatTelegramMessage, formatTelegramErrorMessage } from "./telegram-formatter";

const log = createModuleLogger("financial-ceiling:telegram");

/**
 * Handler principal del comando /techo.
 * Siempre retorna sin lanzar excepciones (safe for bot integration).
 */
export async function handleTechoCommand(
  bot: TelegramBot,
  chatId: string,
  query: string,
): Promise<void> {
  if (!query || query.trim().length < 3) {
    await bot
      .sendMessage(
        chatId,
        "📊 <b>Uso:</b> <code>/techo LA-050GYR019-E11-2026</code>\n\nEspecifica un número de licitación o texto descriptivo.",
        { parse_mode: "HTML" },
      )
      .catch(() => {});
    return;
  }

  // Verificar que el feature esté habilitado
  if (process.env.ENABLE_FINANCIAL_CEILING_COMMAND === "false") {
    await bot
      .sendMessage(chatId, "⚠️ El comando /techo está deshabilitado (ENABLE_FINANCIAL_CEILING_COMMAND=false).")
      .catch(() => {});
    return;
  }

  log.info({ query, chatId }, "📥 /techo recibido");

  // Mensaje de inicio
  await bot
    .sendMessage(chatId, `🔍 Analizando techo financiero para:\n<code>${query}</code>\n\nEsto puede tomar unos segundos...`, {
      parse_mode: "HTML",
    })
    .catch(() => {});

  try {
    const report = await analyzeFinancialCeiling(query);

    if (
      report.financialCeiling.type === "no_determinado" &&
      report.financialCeiling.confidence === "BAJA"
    ) {
      // Sin información suficiente
      const reason = report.warnings.join(" ") || "No se encontraron contratos similares en fuentes públicas.";
      const msg = formatTelegramErrorMessage(
        query,
        report.sourcesConsulted.map((s) => ({ document: s.document, status: s.status })),
        reason,
      );
      await bot.sendMessage(chatId, msg, { parse_mode: "HTML", disable_web_page_preview: true }).catch(() => {});
    } else {
      const msg = formatTelegramMessage(report);
      await bot.sendMessage(chatId, msg, { parse_mode: "HTML", disable_web_page_preview: true }).catch(() => {});
    }

    log.info({ query, confidence: report.financialCeiling.confidence }, "✅ /techo respondido");
  } catch (err) {
    log.error({ err, query }, "❌ Error en /techo");
    await bot
      .sendMessage(
        chatId,
        "📊 <b>ANÁLISIS DE TECHO FINANCIERO</b>\n\nNo pude estimar el techo financiero con fuentes públicas suficientes.\n\n⚠️ Error interno — revisar logs.",
        { parse_mode: "HTML" },
      )
      .catch(() => {});
  }
}
