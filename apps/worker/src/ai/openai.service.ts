import OpenAI from "openai";
import { createModuleLogger } from "../core/logger";

const log = createModuleLogger("openai-service");

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

export interface TenderDocumentAnalysis {
  score: number;
  summary: string;
  opportunities: string[];
  risks: string[];
}

const systemPrompt = `Eres un analista experto en licitaciones de gobierno en México.
Tu objetivo es detectar oportunidades reales de negocio y riesgos para un proveedor privado.

Analiza señales como: "adjudicación directa", "segunda convocatoria", "urgente", ampliaciones de plazo, requisitos técnicos, garantías, penalizaciones, cumplimiento legal y viabilidad operativa.

Debes responder EXCLUSIVAMENTE en JSON válido con este formato exacto:
{
  "score": number (0-100),
  "summary": string,
  "opportunities": string[],
  "risks": string[]
}

Reglas:
- No inventes información que no esté en el documento.
- Si hay poca evidencia, reduce score y explica incertidumbre en summary.
- opportunities y risks deben ser bullets concretos, accionables y no vacíos.
- score=0 muy mala oportunidad / score=100 oportunidad muy alta con riesgo controlado.`;

function ensureApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY no está configurada");
  }
  return apiKey;
}

function normalizeResult(payload: unknown): TenderDocumentAnalysis {
  const obj = (payload ?? {}) as Record<string, unknown>;

  const scoreRaw = Number(obj.score);
  const score = Number.isFinite(scoreRaw)
    ? Math.max(0, Math.min(100, Math.round(scoreRaw)))
    : 0;

  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  const opportunities = Array.isArray(obj.opportunities)
    ? obj.opportunities.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const risks = Array.isArray(obj.risks)
    ? obj.risks.map((item) => String(item).trim()).filter(Boolean)
    : [];

  return {
    score,
    summary,
    opportunities,
    risks,
  };
}

export async function analyzeTenderDocument(
  text: string,
): Promise<TenderDocumentAnalysis> {
  if (!text.trim()) {
    throw new Error("Texto vacío: no se puede analizar el documento");
  }

  const client = new OpenAI({ apiKey: ensureApiKey() });

  try {
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: `Analiza el siguiente documento de licitación y devuelve el JSON solicitado:\n\n${text}`,
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
