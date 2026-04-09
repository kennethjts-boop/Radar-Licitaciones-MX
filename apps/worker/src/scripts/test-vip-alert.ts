import { analyzeTenderDocument, generateEmbedding } from "../ai/openai.service";
import {
  formatAiVipAlertMessage,
  sendTelegramMessage,
} from "../alerts/telegram.alerts";
import { BUSINESS_PROFILE } from "../config/business_profile";
import { sanitizeForKeywordRegex } from "../core/text";

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

async function main(): Promise<void> {
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

  console.log("▶ Iniciando simulacro VIP...");

  const excludedKeyword = detectExcludedKeyword(simulatedTenderText);
  if (excludedKeyword) {
    console.log(
      `⛔ Simulacro abortado: pre-filtro descartó por EXCLUDED_KEYWORD='${excludedKeyword}'`,
    );
    return;
  }

  console.log("✅ Pre-filtro aprobado (sin EXCLUDED_KEYWORDS)");

  try {
    if (process.env.MOCK_EMBEDDING === "true") {
      console.log("🧪 generateEmbedding mockeado por MOCK_EMBEDDING=true");
    } else {
      const embedding = await generateEmbedding(simulatedTenderText.slice(0, 1200));
      console.log(`✅ Embedding generado (${embedding.length} dimensiones)`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(
      `⚠️ No se pudo generar embedding real (${message}). Continuando con simulacro...`,
    );
  }

  const ragContext = `
Antecedente 1: En 2024 se adjudicó suministro de papel térmico para plazas de cobro con entregas escalonadas.
Antecedente 2: En 2025 se detectaron retrasos de logística en temporada alta y se reforzaron penalizaciones.
Antecedente 3: CAPUFE prioriza proveedores con capacidad de entregas regionales y evidencia de calidad estable.
`.trim();

  const boundedContext = ragContext.slice(0, MAX_HISTORICAL_CONTEXT_CHARS);

  const analysis = await analyzeTenderDocument(simulatedTenderText, boundedContext);
  console.log("✅ analyzeTenderDocument completado");
  console.log(
    `📊 Resultado IA | total=${analysis.scores.total} | win_probability=${analysis.opportunity_engine.win_probability} | category=${analysis.category_detected} | is_relevant=${analysis.is_relevant}`,
  );

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
    throw new Error("No se pudo construir mensaje VIP para simulacro");
  }

  const messageId = await sendTelegramMessage(vipMessage, "HTML");
  console.log(`🚀 Alerta VIP enviada a Telegram. message_id=${messageId ?? "N/D"}`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`❌ Simulacro falló: ${message}`);
  process.exit(1);
});
