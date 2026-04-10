import TelegramBot from "node-telegram-bot-api";
import { createModuleLogger } from "../core/logger";
import {
  buildInlineSelectionPointers,
  selectOptionByKey,
  startActiveSearch,
} from "./agent.service";
import {
  AGENT_MANUAL_CAPUFE_LINK,
} from "./search.handler";
import { analyzeLicitacionByUrl, analyzeSelectedLicitacion } from "./deep-analysis.service";
import { generateIntelligencePdf } from "./pdf-report.util";

const log = createModuleLogger("agent-telegram");

function shortLabel(input: string, max = 60): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}…`;
}


function detectProcurementLink(text: string): string | null {
  const urlRegex = /(https?:\/\/\S+)/gi;
  const matches = text.match(urlRegex);
  if (!matches) return null;

  for (const rawUrl of matches) {
    const url = rawUrl.trim();
    if (/(comprasmx\.hacienda\.gob\.mx|comprasmx\.buengobierno\.gob\.mx|dof\.gob\.mx)/i.test(url)) {
      return url;
    }
  }

  return null;
}

function buildExecutiveMessage(payload: {
  title: string;
  expedienteId: string;
  report: {
    resumen: string;
    fechas_criticas: string[];
    presupuesto_estimado: string;
    requisitos_experiencia: string[];
    candados_detectados: string[];
    veredicto: string;
    comparativo_capufe: string;
  };
}): string {
  const fechas = payload.report.fechas_criticas.length
    ? payload.report.fechas_criticas.map((f) => `• ${f}`).join("\n")
    : "• No especificadas";
  const requisitos = payload.report.requisitos_experiencia.length
    ? payload.report.requisitos_experiencia.map((r) => `• ${r}`).join("\n")
    : "• No especificados";
  const candados = payload.report.candados_detectados.length
    ? payload.report.candados_detectados.map((r) => `• ${r}`).join("\n")
    : "• No detectados";

  return [
    `🧠 <b>Deep Analysis — ${payload.expedienteId}</b>`,
    `<b>${payload.title}</b>`,
    "",
    `<b>Resumen:</b> ${payload.report.resumen}`,
    "",
    "<b>Fechas:</b>",
    fechas,
    "",
    `<b>Presupuesto estimado:</b> ${payload.report.presupuesto_estimado}`,
    "",
    "<b>Requisitos de experiencia:</b>",
    requisitos,
    "",
    "<b>Candados detectados:</b>",
    candados,
    "",
    `<b>Comparativo CAPUFE:</b> ${payload.report.comparativo_capufe}`,
    "",
    `<b>Veredicto:</b> ${payload.report.veredicto}`,
  ].join("\n");
}
export function registerAgentCommands(bot: TelegramBot, chatId: string): void {
  bot.onText(/\/buscar(?:\s+(.+))?/, async (msg, match) => {
    if (String(msg.chat.id) !== chatId) return;

    const query = match?.[1]?.trim();

    if (!query) {
      await bot.sendMessage(
        chatId,
        "🔍 ¿Qué licitación o palabra clave quieres que rastree ahora mismo?",
      );
      return;
    }

    await bot.sendMessage(
      chatId,
      `🛰️ Iniciando búsqueda activa para: '${query}'... Dame un momento.`,
    );

    // Fire-and-forget para mantener el comando no bloqueante.
    void (async () => {
      const session = await startActiveSearch(String(msg.chat.id), query);

      if (session.status === "error") {
        await bot
          .sendMessage(
            chatId,
            `❌ La búsqueda activa para '${query}' falló: ${session.errorMessage ?? "error desconocido"}`,
          )
          .catch(() => {});
        return;
      }

      if (session.options.length === 0) {
        await bot
          .sendMessage(
            chatId,
            "Investigando a fondo... generando tu expediente PDF.",
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "🔎 Abrir últimas CAPUFE",
                      url: AGENT_MANUAL_CAPUFE_LINK,
                    },
                  ],
                ],
              },
            },
          )
          .catch(() => {});

        return;
      }

      const pointers = buildInlineSelectionPointers(session);
      const inlineKeyboard = pointers.map(({ selectionKey, option }, index) => [
        {
          text: `${index + 1}. ${shortLabel(option.licitacionNombre)}`,
          callback_data: selectionKey,
        },
      ]);

      const lines = [
        `✅ /buscar activo y listo. Encontré ${session.options.length} licitación(es):`,
        "",
        ...session.options.map(
          (option, index) =>
            `${index + 1}) ${option.licitacionNombre}\n   🏢 ${option.dependencia}\n   🆔 ${option.expedienteId}`,
        ),
        "",
        "👉 Toca un botón para seleccionar la licitación y continuar a investigación profunda (Fase 2).",
      ];

      await bot
        .sendMessage(chatId, lines.join("\n"), {
          reply_markup: {
            inline_keyboard: inlineKeyboard,
          },
        })
        .catch(() => {});

      log.info(
        { query, options: session.options.length, from: msg.from?.username },
        "Active search finished with inline menu",
      );
    })().catch((err) => {
      log.error({ err, query }, "Unhandled agent search execution error");
    });
  });

  bot.on("message", async (msg) => {
    if (String(msg.chat.id) !== chatId) return;

    const text = msg.text?.trim();
    if (!text) return;
    if (text.startsWith("/")) return;

    const detectedLink = detectProcurementLink(text);
    if (!detectedLink) return;

    await bot
      .sendMessage(
        chatId,
        "🔍 Detecté un enlace de licitación. Iniciando extracción forzada...",
      )
      .catch(() => {});

    await bot
      .sendMessage(
        chatId,
        `🚀 Fase 2 (Deep Analysis) activada en modo manual para:
${detectedLink}`,
      )
      .catch(() => {});

    void (async () => {
      try {
        const analysis = await analyzeLicitacionByUrl(detectedLink);
        await bot.sendMessage(chatId, buildExecutiveMessage(analysis), {
          parse_mode: "HTML",
        });
        const pdfBuffer = generateIntelligencePdf(analysis);
        await bot.sendDocument(chatId, pdfBuffer, {
          caption: `📄 Expediente de Inteligencia generado: ${analysis.expedienteId}`,
        }, {
          filename: `expediente-inteligencia-${analysis.expedienteId}.pdf`,
          contentType: "application/pdf",
        });
      } catch (err) {
        await bot
          .sendMessage(
            chatId,
            `❌ No pude completar el Deep Analysis para el link manual: ${err instanceof Error ? err.message : String(err)}`,
          )
          .catch(() => {});
      }
    })();
  });

  bot.on("callback_query", async (callbackQuery) => {
    const message = callbackQuery.message;
    if (!message || String(message.chat.id) !== chatId) return;
    const selectionKey = callbackQuery.data;
    if (!selectionKey?.startsWith("sel:")) return;

    const selected = selectOptionByKey(String(message.chat.id), selectionKey);

    if (!selected) {
      await bot
        .answerCallbackQuery(callbackQuery.id, {
          text: "⚠️ Esta selección expiró o ya no está disponible.",
          show_alert: false,
        })
        .catch(() => {});
      return;
    }

    await bot
      .answerCallbackQuery(callbackQuery.id, {
        text: `✅ Seleccionado: ${selected.expedienteId}`,
        show_alert: false,
      })
      .catch(() => {});

    await bot
      .sendMessage(
        chatId,
        `🎯 Selección guardada para Fase 2:\n${selected.licitacionNombre}\n🏢 ${selected.dependencia}\n🆔 ${selected.expedienteId}`,
      )
      .catch(() => {});

    void (async () => {
      await bot
        .sendMessage(
          chatId,
          `🧠 Iniciando Deep Analysis estratégico para ${selected.expedienteId}...`,
        )
        .catch(() => {});

      try {
        const analysis = await analyzeSelectedLicitacion(selected.expedienteId);
        await bot.sendMessage(chatId, buildExecutiveMessage(analysis), {
          parse_mode: "HTML",
        });
        const pdfBuffer = generateIntelligencePdf(analysis);
        await bot.sendDocument(chatId, pdfBuffer, {
          caption: `📄 Expediente de Inteligencia generado: ${analysis.expedienteId}`,
        }, {
          filename: `expediente-inteligencia-${analysis.expedienteId}.pdf`,
          contentType: "application/pdf",
        });
      } catch (err) {
        await bot
          .sendMessage(
            chatId,
            `❌ Error en Deep Analysis para ${selected.expedienteId}: ${err instanceof Error ? err.message : String(err)}`,
          )
          .catch(() => {});
      }
    })();
  });

  log.info("✅ Comando de agente registrado: /buscar + selección inline");
}
