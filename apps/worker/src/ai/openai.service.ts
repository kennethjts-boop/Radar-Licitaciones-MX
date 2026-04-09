import OpenAI from "openai";
import { createModuleLogger } from "../core/logger";

const log = createModuleLogger("openai-service");

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

export interface TenderDocumentAnalysis {
  scores: {
    total: number;
    technical: number;
    commercial: number;
    urgency: number;
    viability: number;
  };
  key_data: {
    contract_type: string;
    deadline: string;
    guarantees: string;
  };
  summary: string;
  opportunities: string[];
  risks: string[];
}

const systemPrompt = `Eres un analista experto en licitaciones de gobierno en México.
Tu objetivo es detectar oportunidades reales de negocio y riesgos para un proveedor privado.

Analiza señales como: "adjudicación directa", "segunda convocatoria", "urgente", ampliaciones de plazo, requisitos técnicos, garantías, penalizaciones, cumplimiento legal y viabilidad operativa.

Debes responder EXCLUSIVAMENTE en JSON válido con este formato exacto:
{
  "scores": {
    "total": number (0-100),
    "technical": number (0-100),
    "commercial": number (0-100),
    "urgency": number (0-100),
    "viability": number (0-100)
  },
  "key_data": {
    "contract_type": string,
    "deadline": string,
    "guarantees": string
  },
  "summary": string (máximo 15 palabras),
  "opportunities": string[] (máximo 3, bullets cortos),
  "risks": string[] (máximo 3, bullets cortos)
}

Reglas:
- No inventes información que no esté en el documento.
- Si hay poca evidencia, reduce scores y expresa incertidumbre.
- summary debe ser directo y corto (estilo titular, sin narrativa).
- opportunities y risks deben ser balazos accionables, concretos y no vacíos.
- Si falta dato en key_data usa "No especificado".
- scores.total=0 mala oportunidad / scores.total=100 oportunidad alta con riesgo controlado.`;

function ensureApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY no está configurada");
  }
  return apiKey;
}

function normalizeResult(payload: unknown): TenderDocumentAnalysis {
  const obj = (payload ?? {}) as Record<string, unknown>;

  const scoreObj = (obj.scores ?? {}) as Record<string, unknown>;
  const keyDataObj = (obj.key_data ?? {}) as Record<string, unknown>;

  const normalizeScore = (value: unknown): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? Math.max(0, Math.min(100, Math.round(numeric)))
      : 0;
  };

  const ensureString = (value: unknown, fallback = "No especificado"): string => {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized || fallback;
  };

  const summaryRaw = typeof obj.summary === "string" ? obj.summary.trim() : "";
  const summaryWords = summaryRaw.split(/\s+/).filter(Boolean).slice(0, 15);
  const summary = summaryWords.join(" ");
  const opportunities = Array.isArray(obj.opportunities)
    ? obj.opportunities
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const risks = Array.isArray(obj.risks)
    ? obj.risks.map((item) => String(item).trim()).filter(Boolean).slice(0, 3)
    : [];

  return {
    scores: {
      total: normalizeScore(scoreObj.total),
      technical: normalizeScore(scoreObj.technical),
      commercial: normalizeScore(scoreObj.commercial),
      urgency: normalizeScore(scoreObj.urgency),
      viability: normalizeScore(scoreObj.viability),
    },
    key_data: {
      contract_type: ensureString(keyDataObj.contract_type),
      deadline: ensureString(keyDataObj.deadline),
      guarantees: ensureString(keyDataObj.guarantees),
    },
    summary,
    opportunities,
    risks,
  };
}

export async function analyzeTenderDocument(
  text: string,
  historicalContext?: string,
): Promise<TenderDocumentAnalysis> {
  if (!text.trim()) {
    throw new Error("Texto vacío: no se puede analizar el documento");
  }

  const client = new OpenAI({ apiKey: ensureApiKey() });

  try {
    const normalizedHistoricalContext = historicalContext?.trim() ?? "";
    const userPrompt = normalizedHistoricalContext
      ? [
          "Analiza el siguiente documento de licitación y devuelve el JSON solicitado.",
          "",
          "Antecedentes históricos relevantes (RAG):",
          normalizedHistoricalContext,
          "",
          "Usa estos antecedentes reales para identificar si la licitación es recurrente,",
          "si hay patrones de riesgo (por ejemplo proveedor único histórico) y reflejarlo",
          "en summary y opportunities cuando aplique.",
          "",
          "Documento de licitación actual:",
          text,
        ].join("\n")
      : `Analiza el siguiente documento de licitación y devuelve el JSON solicitado:\n\n${text}`;

    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "tender_document_analysis",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["scores", "key_data", "summary", "opportunities", "risks"],
            properties: {
              scores: {
                type: "object",
                additionalProperties: false,
                required: [
                  "total",
                  "technical",
                  "commercial",
                  "urgency",
                  "viability",
                ],
                properties: {
                  total: { type: "integer", minimum: 0, maximum: 100 },
                  technical: { type: "integer", minimum: 0, maximum: 100 },
                  commercial: { type: "integer", minimum: 0, maximum: 100 },
                  urgency: { type: "integer", minimum: 0, maximum: 100 },
                  viability: { type: "integer", minimum: 0, maximum: 100 },
                },
              },
              key_data: {
                type: "object",
                additionalProperties: false,
                required: ["contract_type", "deadline", "guarantees"],
                properties: {
                  contract_type: { type: "string" },
                  deadline: { type: "string" },
                  guarantees: { type: "string" },
                },
              },
              summary: { type: "string", maxLength: 200 },
              opportunities: {
                type: "array",
                maxItems: 3,
                items: { type: "string" },
              },
              risks: {
                type: "array",
                maxItems: 3,
                items: { type: "string" },
              },
            },
          },
          strict: true,
        },
      },
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `${systemPrompt}
- Si te proporcionan antecedentes históricos reales (RAG), utilízalos para detectar recurrencia y patrones de riesgo/oportunidad.
- No trates esos antecedentes como hechos del documento actual; úsalo como contexto comparativo.
- Integra esos hallazgos en summary y opportunities solo cuando haya evidencia.`,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI devolvió respuesta vacía");
    }

    const parsed = JSON.parse(content) as unknown;
    return normalizeResult(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, "Fallo en analyzeTenderDocument");
    throw new Error(`Error analizando documento con OpenAI: ${message}`);
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const input = text.trim();
  if (!input) {
    throw new Error("Texto vacío: no se puede generar embedding");
  }

  const client = new OpenAI({ apiKey: ensureApiKey() });

  try {
    const response = await client.embeddings.create({
      model: OPENAI_EMBEDDING_MODEL,
      input,
    });

    const embedding = response.data[0]?.embedding;
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("OpenAI devolvió embedding vacío");
    }

    return embedding;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, "Fallo en generateEmbedding");
    throw new Error(`Error generando embedding con OpenAI: ${message}`);
  }
}
