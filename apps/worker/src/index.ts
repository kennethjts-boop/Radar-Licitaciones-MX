/**
 * ENTRY POINT — Flujo de arranque del worker Radar Licitaciones MX.
 *
 * Secuencia:
 * 1. Inicializar logger
 * 2. Cargar y validar config (Zod → crash si falta variable)
 * 3. Registrar signal handlers
 * 4. Bootstrap: verificar Supabase + Telegram + system_state
 * 5. Inicializar bot de comandos Telegram (polling)
 * 6. Iniciar scheduler (30 min + daily summary)
 * 7. Exponer endpoint temporal /test-alert para simulacro manual
 * 8. Worker en espera activa
 */
import { createServer, IncomingMessage, ServerResponse } from "http";
import { getConfig } from "./config/env";
import { getLogger } from "./core/logger";
import { bootstrap } from "./bootstrap";
import { SchemaValidationError } from "./storage/schema-validator";
import { startScheduler } from "./jobs/scheduler";
import { initCommandBot } from "./commands/telegram.commands";
import { setComprasMxSourceId } from "./jobs/collect.job";
import { BUSINESS_PROFILE } from "./config/business_profile";
import { sanitizeForKeywordRegex } from "./core/text";
import { analyzeTenderDocument, generateEmbedding } from "./ai/openai.service";
import {
  formatAiVipAlertMessage,
  sendTelegramMessage,
} from "./alerts/telegram.alerts";

const MAX_HISTORICAL_CONTEXT_CHARS = 2_000;

function detectExcludedKeyword(rawText: string): string | null {
  const normalizedText = sanitizeForKeywordRegex(rawText);

  for (const keyword of BUSINESS_PROFILE.EXCLUDED_KEYWORDS) {
    const normalizedKeyword = sanitizeForKeywordRegex(keyword);
    const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|\\b)${escaped}(\\b|$)`, "i");

    if (pattern.test(normalizedText)) {
      return keyword;
    }
  }

  return null;
}

async function runTestAlertFlow(): Promise<{
  messageId: number | null;
  scoreTotal: number;
  winProbability: number;
  category: string;
}> {
  const log = getLogger();

  const simulatedTenderText = `
CAPUFE - CAMINOS Y PUENTES FEDERALES DE INGRESOS Y SERVICIOS CONEXOS
Licitación Pública Nacional Electrónica No. LA-009J0U001-E22-2026
Objeto: Adquisición de rollos de papel térmico para plazas de cobro de la red operada por CAPUFE,
con entregas programadas en 24 plazas de cobro en los estados de Morelos, Puebla, Estado de México,
Querétaro y Veracruz.

Alcance técnico:
- Rollo térmico de alta sensibilidad para impresoras de peaje.
- Gramaje nominal 55 g/m2.
- Resistencia a humedad, abrasión y alta temperatura.
- Compatibilidad con equipos EPC y sistemas actuales de ticketing de CAPUFE.
- Vida útil mínima del impreso: 5 años en condiciones de archivo.
- Entrega bajo esquema just-in-time en almacenes regionales.

Condiciones comerciales:
- Contrato abierto con vigencia de 12 meses.
- Pedido mínimo mensual y máximo anual conforme a demanda operativa.
- Penalizaciones por retraso en entrega y por producto no conforme.
- Garantía de cumplimiento y póliza de calidad.

Cronograma:
- Junta de aclaraciones: 15 de abril de 2026.
- Presentación y apertura de proposiciones: 22 de abril de 2026.
- Fallo: 30 de abril de 2026.
- Inicio de suministro: 10 de mayo de 2026.

Criterio de evaluación:
- Puntos y porcentajes.
- Se considerarán experiencia en suministros para infraestructura carretera,
  capacidad logística multisitio y evidencia de calidad en lotes previos.

Antecedentes:
En ejercicios anteriores, CAPUFE ha emitido compras recurrentes de consumibles térmicos
para plazas de cobro con picos de demanda estacional y ajustes por variación en aforo.
`.trim();

  const excludedKeyword = detectExcludedKeyword(simulatedTenderText);
  if (excludedKeyword) {
    throw new Error(
      `Simulacro bloqueado por EXCLUDED_KEYWORD='${excludedKeyword}'. Ajustar texto de prueba.`,
    );
  }

  try {
    const embedding = await generateEmbedding(simulatedTenderText.slice(0, 1200));
    log.info(
      {
        event: "TEST_ALERT_EMBEDDING_OK",
        embeddingDimensions: embedding.length,
      },
      "Embedding generado para /test-alert",
    );
  } catch (err) {
    log.warn(
      {
        event: "TEST_ALERT_EMBEDDING_FAILED",
        err,
      },
      "No se pudo generar embedding en /test-alert; continuando",
    );
  }

  const historicalContext = `
Antecedente 1: En 2024 se adjudicó suministro de papel térmico para plazas de cobro con entregas escalonadas.
Antecedente 2: En 2025 se detectaron retrasos de logística en temporada alta y se reforzaron penalizaciones.
Antecedente 3: CAPUFE prioriza proveedores con capacidad de entregas regionales y evidencia de calidad estable.
`
    .trim()
    .slice(0, MAX_HISTORICAL_CONTEXT_CHARS);

  const analysis = await analyzeTenderDocument(simulatedTenderText, historicalContext);

  const boostedTotal = Math.max(analysis.scores.total, 88);
  const boostedWinProbability = Math.max(
    analysis.opportunity_engine.win_probability,
    75,
  );

  const vipMessage = formatAiVipAlertMessage({
    categoryDetected:
      analysis.category_detected === "NONE"
        ? "CAPUFE_PEAJE"
        : analysis.category_detected,
    relevanceJustification:
      analysis.relevance_justification ||
      "Simulacro QA: oportunidad claramente alineada a peaje CAPUFE.",
    score: {
      total: boostedTotal,
      technical: Math.max(analysis.scores.technical, 80),
      commercial: Math.max(analysis.scores.commercial, 78),
      urgency: Math.max(analysis.scores.urgency, 82),
      viability: Math.max(analysis.scores.viability, 79),
    },
    licitacionRef: "LA-009J0U001-E22-2026",
    contractType: analysis.key_data.contract_type || "Adquisición de consumibles",
    deadline: analysis.key_data.deadline || "30 de abril de 2026",
    opportunities: analysis.opportunities.length
      ? analysis.opportunities
      : ["Compra recurrente en CAPUFE con demanda sostenida."],
    risks: analysis.risks.length
      ? analysis.risks
      : ["Penalizaciones por retraso logístico multisitio."],
    opportunityEngine: {
      winProbability: boostedWinProbability,
      competitorThreatLevel: analysis.opportunity_engine.competitor_threat_level,
      implementationComplexity: analysis.opportunity_engine.implementation_complexity,
      redFlags: analysis.opportunity_engine.red_flags.length
        ? analysis.opportunity_engine.red_flags
        : ["Verificar cobertura logística en temporada alta."],
    },
    link: "https://comprasmx.buengobierno.gob.mx/",
  });

  if (!vipMessage) {
    throw new Error("No se pudo construir mensaje VIP para /test-alert");
  }

  const messageId = await sendTelegramMessage(vipMessage, "HTML");

  return {
    messageId,
    scoreTotal: boostedTotal,
    winProbability: boostedWinProbability,
    category:
      analysis.category_detected === "NONE"
        ? "CAPUFE_PEAJE"
        : analysis.category_detected,
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const log = getLogger();
  const url = req.url ?? "/";

  if (req.method === "GET" && url === "/test-alert") {
    try {
      const result = await runTestAlertFlow();
      const body = {
        ok: true,
        endpoint: "/test-alert",
        telegramMessageId: result.messageId,
        scoreTotal: result.scoreTotal,
        winProbability: result.winProbability,
        category: result.category,
      };

      log.info(
        {
          event: "TEST_ALERT_SENT",
          telegramMessageId: result.messageId,
          scoreTotal: result.scoreTotal,
          winProbability: result.winProbability,
          category: result.category,
        },
        "Simulacro /test-alert enviado a Telegram",
      );

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body, null, 2));
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(
        {
          event: "TEST_ALERT_FAILED",
          err: message,
        },
        "Falló endpoint /test-alert",
      );

      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify(
          {
            ok: false,
            endpoint: "/test-alert",
            error: message,
          },
          null,
          2,
        ),
      );
      return;
    }
  }

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify(
      {
        ok: true,
        service: "radar-worker",
        availableEndpoints: ["GET /test-alert"],
      },
      null,
      2,
    ),
  );
}

function startHttpServer(): void {
  const log = getLogger();
  const rawPort = process.env.PORT;
  const parsed = rawPort ? Number(rawPort) : 3000;
  const port = Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err: message }, "Error inesperado en servidor HTTP");
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "internal_error" }));
    });
  });

  server.listen(port, () => {
    log.info({ port }, "🌐 HTTP server listo");
  });
}

async function main(): Promise<void> {
  // ── 1. Configuración y logger ─────────────────────────────────────────────
  const config = getConfig(); // crash aquí si falta variable de entorno
  const log = getLogger();

  log.info("Worker booting...");

  log.info(
    {
      env: config.NODE_ENV,
      timezone: config.APP_TIMEZONE,
      collectInterval: config.COLLECT_INTERVAL_MINUTES,
      dailySummaryHour: config.DAILY_SUMMARY_HOUR,
      railway: config.RAILWAY_ENVIRONMENT ?? "local",
    },
    "🚀 Radar Licitaciones MX — worker boot started",
  );

  // ── 2. Signal handlers ────────────────────────────────────────────────────
  process.on("SIGTERM", () => {
    log.info("SIGTERM recibido — cerrando gracefulmente");
    process.exit(0);
  });

  process.on("SIGINT", () => {
    log.info("SIGINT recibido — cerrando");
    process.exit(0);
  });

  process.on("uncaughtException", (err) => {
    log.fatal({ err }, "💥 uncaughtException — el proceso se cerrará");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    log.error({ reason }, "⚠️ unhandledRejection — revisar promesas");
  });

  // ── 3. Bootstrap: DB + Telegram + system_state ────────────────────────────
  log.info("🔧 Iniciando bootstrap de servicios...");
  const bootResult = await bootstrap();

  // Propagar sourceId al heartbeat job para evitar queries repetidas
  if (bootResult.sourceId) {
    setComprasMxSourceId(bootResult.sourceId);
    log.info(
      { sourceId: bootResult.sourceId },
      "🔑 Source ID comprasmx propagado",
    );
  } else {
    log.warn(
      "⚠️ Source ID comprasmx no disponible — se resolverá en primer ciclo",
    );
  }

  // ── 4. Bot de comandos Telegram ───────────────────────────────────────────
  if (bootResult.telegramOk) {
    try {
      initCommandBot();
      log.info("🤖 Bot Telegram iniciado con polling");
    } catch (err) {
      log.warn({ err }, "⚠️ Error iniciando bot — continuando sin comandos");
    }
  } else {
    log.warn("⚠️ Bot Telegram desactivado — Telegram no disponible");
  }

  // ── 5. Scheduler ──────────────────────────────────────────────────────────
  startScheduler();
  log.info("✅ Scheduler iniciado");

  // ── 6. Endpoint temporal /test-alert ─────────────────────────────────────
  startHttpServer();

  // ── 7. Resumen de arranque ────────────────────────────────────────────────
  log.info(
    {
      supabase: bootResult.supabaseOk ? "ok" : "down",
      telegram: bootResult.telegramOk ? "ok" : "down",
      bot: bootResult.botUsername ?? "N/A",
      sourceId: bootResult.sourceId ?? "pendiente",
    },
    "✅ Worker activo — esperando ciclos",
  );
}

main().catch((err) => {
  const log = getLogger();
  if (err instanceof SchemaValidationError) {
    log.fatal(
      {
        missing: err.missing,
        found: err.found,
        total: err.total,
      },
      [
        "💥 FATAL: DATABASE SCHEMA NOT INITIALIZED",
        `  Tables found: ${err.found} / ${err.total}`,
        `  Missing: [${err.missing.join(", ")}]`,
        "  Fix: Execute docs/supabase-schema.sql in Supabase SQL Editor",
      ].join("\n"),
    );
  } else {
    log.fatal({ err }, "💥 Fatal error starting worker");
  }
  process.exit(1);
});
