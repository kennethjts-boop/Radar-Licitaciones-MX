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

const log = createModuleLogger("agent-telegram");
const DEEP_ANALYSIS_TIMEOUT_MS = 3 * 60 * 1000;

class DeepAnalysisTimeoutError extends Error {
  constructor() {
    super("Deep analysis timeout");
  }
}

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

function resolveSemaphore(veredicto: string): string {
  const normalized = veredicto.toLowerCase();
  if (normalized.includes("alto") || normalized.includes("alta")) return "🟢";
  if (normalized.includes("medio") || normalized.includes("media")) return "🟡";
  if (normalized.includes("bajo") || normalized.includes("baja")) return "🔴";
  return "🟡";
}

function buildActionKeyboard(sourceUrl: string): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "🔎 Ver enlace original", url: sourceUrl }],
      [{ text: "🔄 Nueva búsqueda", callback_data: "agent:new_search" }],
    ],
  };
}

function buildExecutiveMessage(payload: {
  title: string;
  expedienteId: string;
  sourceUrl: string;
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
  const semaforo = resolveSemaphore(payload.report.veredicto);
  const fechas = payload.report.fechas_criticas.length
    ? payload.report.fechas_criticas.map((f) => `- ${f}`).join("\n")
    : "- No especificadas";
  const requisitos = payload.report.requisitos_experiencia.length
    ? payload.report.requisitos_experiencia.map((r) => `- ${r}`).join("\n")
    : "- No especificados";
  const candados = payload.report.candados_detectados.length
    ? payload.report.candados_detectados.map((r) => `- ${r}`).join("\n")
    : "- No detectados";

  return [
    `${semaforo} **VEREDICTO:** ${payload.report.veredicto}`,
    "",
    `**Deep Analysis — ${payload.expedienteId}**`,
    `**${payload.title}**`,
    "",
    "---",
    "",
    "**Resumen Ejecutivo**",
    payload.report.resumen,
    "",
    "---",
    "",
    "**Puntos Críticos**",
    "**Fechas clave:**",
    fechas,
    "",
    `**Presupuesto estimado:** ${payload.report.presupuesto_estimado}`,
    "",
    "**Requisitos clave:**",
    requisitos,
    "",
    "---",
    "",
    '**Análisis de "Candados"**',
    candados,
    "",
    "---",
    "",
    "**Contexto RAG (Comparativa con datos previos)**",
    payload.report.comparativo_capufe,
    "",
    "---",
    "",
    `Fuente: ${payload.sourceUrl}`,
  ].join("\n");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new DeepAnalysisTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
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
      "🛰️ Agente activo: Analizando licitación en modo texto...",
    );

    // Fire-and-forget para mantener el comando no bloqueante.
    void (async () => {
      const stopHeartbeat = startSearchHeartbeat(bot, chatId);
      const session = await startActiveSearch(String(msg.chat.id), query).finally(() => {
        stopHeartbeat();
      });

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
            "Investigando a fondo... te enviaré el expediente completo en texto.",
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
        "🛰️ Agente activo: Analizando licitación en modo texto...",
      )
      .catch(() => {});

    await bot
      .sendMessage(
        chatId,
        `🛰️ Agente activo: Analizando licitación en modo texto...\n${detectedLink}`,
      )
      .catch(() => {});

    void (async () => {
      try {
        const analysis = await analyzeLicitacionByUrl(detectedLink);
        await bot.sendMessage(chatId, buildExecutiveMessage({
          ...analysis,
          sourceUrl: detectedLink,
        }), {
          reply_markup: buildActionKeyboard(detectedLink),
        });
      } catch (err) {
        if (err instanceof DeepAnalysisTimeoutError) {
          await bot
            .sendMessage(
              chatId,
              "⚠️ El documento es demasiado pesado. Generando resumen simplificado...",
            )
            .catch(() => {});

          const simplified = buildSimplifiedResult("manual-link", "Licitación por enlace manual");
          await bot.sendMessage(chatId, buildExecutiveMessage(simplified), {
            parse_mode: "HTML",
          }).catch(() => {});
          const simplePdf = generateIntelligencePdf(simplified);
          await bot.sendDocument(chatId, simplePdf, {
            caption: "📄 Expediente simplificado por timeout",
          }, {
            filename: "expediente-simplificado-timeout.pdf",
            contentType: "application/pdf",
          }).catch(() => {});
          return;
        }
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
    if (selectionKey === "agent:new_search") {
      await bot
        .answerCallbackQuery(callbackQuery.id, {
          text: "🔄 Envíame /buscar + términos para lanzar una nueva investigación.",
          show_alert: false,
        })
        .catch(() => {});
      return;
    }

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
        `🛰️ Agente activo: Analizando licitación en modo texto...\n${selected.licitacionNombre}\n🏢 ${selected.dependencia}\n🆔 ${selected.expedienteId}`,
      )
      .catch(() => {});

    void (async () => {
      await bot
        .sendMessage(
          chatId,
          "🛰️ Agente activo: Analizando licitación en modo texto...",
        )
        .catch(() => {});

      try {
        const analysis = await analyzeSelectedLicitacion(selected.expedienteId);
        await bot.sendMessage(chatId, buildExecutiveMessage({
          ...analysis,
          sourceUrl: selected.sourceUrl,
        }), {
          reply_markup: buildActionKeyboard(selected.sourceUrl),
        });
      } catch (err) {
        if (err instanceof DeepAnalysisTimeoutError) {
          await bot
            .sendMessage(
              chatId,
              "⚠️ El documento es demasiado pesado. Generando resumen simplificado...",
            )
            .catch(() => {});

          const simplified = buildSimplifiedResult(
            selected.expedienteId,
            selected.licitacionNombre,
          );
          await bot.sendMessage(chatId, buildExecutiveMessage(simplified), {
            parse_mode: "HTML",
          }).catch(() => {});
          const simplePdf = generateIntelligencePdf(simplified);
          await bot.sendDocument(chatId, simplePdf, {
            caption: `📄 Expediente simplificado: ${selected.expedienteId}`,
          }, {
            filename: `expediente-simplificado-${selected.expedienteId}.pdf`,
            contentType: "application/pdf",
          }).catch(() => {});
          return;
        }
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
