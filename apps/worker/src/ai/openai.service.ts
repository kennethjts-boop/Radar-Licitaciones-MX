import OpenAI from "openai";
import { createModuleLogger } from "../core/logger";
import { BUSINESS_PROFILE, BusinessCategory } from "../config/business_profile";
import companyProfile from "../config/company_profile.json";

const log = createModuleLogger("ai-service");

const AI_PROVIDER = process.env.AI_PROVIDER || "openai";
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const PRIMARY_AI_MODEL = process.env.PRIMARY_AI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
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
  audio_summary?: string;
  opportunities: string[];
  risks: string[];
  fraud_radar?: {
    is_likely_fractioned: boolean;
    is_likely_directed: boolean;
    evidence: string;
  };
  opportunity_engine: {
    win_probability: number;
    competitor_threat_level: "LOW" | "MEDIUM" | "HIGH";
    implementation_complexity: "LOW" | "MEDIUM" | "HIGH";
    red_flags: string[];
  };
  category_detected: BusinessCategory | "NONE";
  is_relevant: boolean;
  relevance_justification: string;
}

const systemPrompt = `Actúas como Director de Estrategia para la empresa "${companyProfile.company_name}".
Tu objetivo es analizar licitaciones y determinar si son una oportunidad real basándote en nuestro PERFIL MAESTRO.

PERFIL DE NUESTRA EMPRESA:
- Descripción: ${companyProfile.business_description}
- Experiencia: ${companyProfile.experience.join(", ")}
- Certificaciones: ${companyProfile.certifications.join(", ")}
- Capacidad Financiera: Capital de $${companyProfile.financial_capacity.capital_social}
- Regiones de interés: ${companyProfile.target_regions.join(", ")}

INSTRUCCIONES DE ANÁLISIS:
1. Analiza señales de "licitación dirigida" (incumbent threat) buscando candados.
2. Compara los requisitos técnicos de la licitación contra nuestras certificaciones. 
   - Si piden una certificación que NO tenemos (${companyProfile.certifications.join(", ")} son las que sí tenemos), reduce drásticamente la win_probability.
3. **DETECCIÓN DE FRACCIONAMIENTO:** Si te proporcionan antecedentes históricos, busca si hay licitaciones recurrentes con objetos muy similares y montos bajos (justo por debajo del límite de licitación pública). Advierte si parece que están dividiendo un contrato grande para evitar un concurso abierto.
4. Evalúa si el monto de la licitación es manejable para nuestra capacidad financiera.
5. Detecta oportunidades reales, riesgos y probabilidad de ganar.

Contexto de negocio (categorías):
{{BUSINESS_CATEGORIES}}

Debes responder EXCLUSIVAMENTE en JSON válido con este formato:
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
  "audio_summary": string (máximo 40 palabras, estilo locutor de noticias, entusiasta pero profesional),
  "opportunities": string[] (máximo 3),
  "risks": string[] (máximo 3),
  "fraud_radar": {
    "is_likely_fractioned": boolean,
    "is_likely_directed": boolean,
    "evidence": string (máximo 20 palabras)
  },
  "opportunity_engine": {
    "win_probability": number (0-100),
    "competitor_threat_level": "LOW" | "MEDIUM" | "HIGH",
    "implementation_complexity": "LOW" | "MEDIUM" | "HIGH",
    "red_flags": string[] (máximo 5, candados o requisitos que NO cumplimos)
  },
  "category_detected": string,
  "is_relevant": boolean,
  "relevance_justification": string
}

Reglas de Oro:
- Sé honesto y cínico: si la licitación parece "amañada" para alguien más, dilo.
- Si detectas fraccionamiento, márcalo en el campo fraud_radar.
- Si nos falta una certificación crítica, la probabilidad de ganar debe ser menor al 30%.
- El resumen debe ser directo y corto.`;

function ensureApiKey(): string {
  const apiKey = AI_PROVIDER === "openrouter" 
    ? process.env.OPENROUTER_API_KEY 
    : process.env.OPENAI_API_KEY;
    
  if (!apiKey) {
    throw new Error(`${AI_PROVIDER.toUpperCase()}_API_KEY no está configurada`);
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
  const relevanceJustificationRaw =
    typeof obj.relevance_justification === "string"
      ? obj.relevance_justification.trim()
      : "";
  const summaryWords = summaryRaw.split(/\s+/).filter(Boolean).slice(0, 15);
  const summary = summaryWords.join(" ");
  const relevanceWords = relevanceJustificationRaw
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 15);
  const relevanceJustification = relevanceWords.join(" ") || "No especificado";
  const opportunities = Array.isArray(obj.opportunities)
    ? obj.opportunities
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const risks = Array.isArray(obj.risks)
    ? obj.risks.map((item) => String(item).trim()).filter(Boolean).slice(0, 3)
    : [];
  
  const fraudRadarObj = (obj.fraud_radar ?? {}) as Record<string, unknown>;
  const fraud_radar = {
    is_likely_fractioned: fraudRadarObj.is_likely_fractioned === true,
    is_likely_directed: fraudRadarObj.is_likely_directed === true,
    evidence: ensureString(fraudRadarObj.evidence, "No se detectó evidencia clara.")
  };

  const opportunityEngineObj = (obj.opportunity_engine ?? {}) as Record<string, unknown>;
  const normalizeThreatLevel = (
    value: unknown,
  ): "LOW" | "MEDIUM" | "HIGH" => {
    const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (normalized === "LOW" || normalized === "MEDIUM" || normalized === "HIGH") {
      return normalized;
    }
    return "MEDIUM";
  };
  const redFlags = Array.isArray(opportunityEngineObj.red_flags)
    ? opportunityEngineObj.red_flags
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 5)
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
    audio_summary: ensureString(obj.audio_summary as string, "Sin resumen de audio disponible."),
    opportunities,
    risks,
    fraud_radar,
    opportunity_engine: {
      win_probability: normalizeScore(opportunityEngineObj.win_probability),
      competitor_threat_level: normalizeThreatLevel(
        opportunityEngineObj.competitor_threat_level,
      ),
      implementation_complexity: normalizeThreatLevel(
        opportunityEngineObj.implementation_complexity,
      ),
      red_flags: redFlags,
    },
    category_detected:
      typeof obj.category_detected === "string" &&
      [
        "CAPUFE_VEHICULOS",
        "CAPUFE_PEAJE",
        "CAPUFE_OPORTUNIDADES",
        "CONAVI_FEDERAL",
        "IMSS_MORELOS",
        "ISSSTE_CENTRAL",
      ].includes(obj.category_detected)
        ? (obj.category_detected as BusinessCategory)
        : "NONE",
    is_relevant: obj.is_relevant === true,
    relevance_justification: relevanceJustification,
  };
}

export async function analyzeTenderDocument(
  text: string,
  historicalContext?: string,
): Promise<TenderDocumentAnalysis> {
  if (!text.trim()) {
    throw new Error("Texto vacío: no se puede analizar el documento");
  }

  const FREE_MODELS_POOL = [
      PRIMARY_AI_MODEL,
      "google/gemma-2-9b-it:free",
      "meta-llama/llama-3-8b-instruct:free",
      "mistralai/mistral-7b-instruct:free"
    ];

    const client = new OpenAI({ 
      apiKey: ensureApiKey(),
      baseURL: AI_PROVIDER === "openrouter" ? OPENROUTER_BASE_URL : undefined,
      defaultHeaders: AI_PROVIDER === "openrouter" ? {
        "HTTP-Referer": "https://radar-licitaciones.mx",
        "X-Title": "Radar Licitaciones MX",
      } : undefined
    });

    const userPrompt = normalizedHistoricalContext
      ? [
          "Analiza el siguiente documento de licitación y devuelve el JSON solicitado.",
          "",
          "Categorías de negocio:",
          categoriesBlock,
          `EXCLUDED_KEYWORDS: ${excludedKeywordsList}`,
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
      : [
          "Analiza el siguiente documento de licitación y devuelve el JSON solicitado.",
          "",
          "Categorías de negocio:",
          categoriesBlock,
          `EXCLUDED_KEYWORDS: ${excludedKeywordsList}`,
          "",
          "Documento de licitación actual:",
          text,
        ].join("\n");

    let lastError = null;

    if (AI_PROVIDER === "openrouter") {
      for (const model of FREE_MODELS_POOL) {
        try {
          log.info({ model }, "Intentando análisis con modelo del pool");
          const completion = await client.chat.completions.create({
            model: model,
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: `${systemPrompt.replace("{{BUSINESS_CATEGORIES}}", categoriesBlock)}
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
          if (!content) throw new Error("Respuesta vacía");
          
          const parsed = JSON.parse(content) as unknown;
          return normalizeResult(parsed);
        } catch (err) {
          lastError = err;
          log.warn({ model, err: err.message }, "Fallo en modelo del pool, reintentando...");
          continue;
        }
      }
      throw new Error(`Todos los modelos del pool fallaron. Último error: ${lastError?.message}`);
    }

    // Fallback OpenAI legacy
    const completion = await client.chat.completions.create({
 = await client.chat.completions.create(options);

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI devolvió respuesta vacía");
    }

    const parsed = JSON.parse(content) as unknown;
    return normalizeResult(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, "Fallo en analyzeTenderDocument");
    throw new Error(`Error analizando documento con ${AI_PROVIDER.toUpperCase()}: ${message}`);
  }
}

export async function detectAbusiveClauses(text: string): Promise<{
  abusive_clauses: Array<{ clause: string; reason: string; severity: "LOW" | "MEDIUM" | "HIGH" }>;
  is_likely_directed: boolean;
  score: number;
}> {
  if (!text.trim()) {
    throw new Error("Texto vacío: no se puede analizar");
  }

  const client = new OpenAI({ 
    apiKey: ensureApiKey(),
    baseURL: AI_PROVIDER === "openrouter" ? OPENROUTER_BASE_URL : undefined,
    defaultHeaders: AI_PROVIDER === "openrouter" ? {
      "HTTP-Referer": "https://radar-licitaciones.mx",
      "X-Title": "Radar Licitaciones MX",
    } : undefined
  });

  const systemPromptAbusive = `Eres un Auditor Forense Especializado en Licitaciones Públicas Mexicanas.
Tu objetivo es detectar CLÁUSULAS ABUSIVAS o CANDADOS que sugieran que una licitación está dirigida a un proveedor específico.

Busca:
1. Certificaciones ultra-específicas o poco comunes.
2. Tiempos de entrega imposibles (ej. 24 horas para suministros complejos).
3. Especificaciones de marca/modelo sin permitir equivalentes reales.
4. Experiencia excesiva o contratos previos con montos irreales.
5. Requisitos de capital social desproporcionados al monto del contrato.

Responde ÚNICAMENTE en JSON con este formato:
{
  "abusive_clauses": [
    { "clause": "texto de la cláusula", "reason": "por qué es abusiva", "severity": "LOW"|"MEDIUM"|"HIGH" }
  ],
  "is_likely_directed": boolean,
  "score": number (0-100, donde 100 es totalmente dirigida/corrupta)
}`;

  try {
    const response = await client.chat.completions.create({
      model: PRIMARY_AI_MODEL,
      temperature: 0.1,
      response_format: AI_PROVIDER === "openai" ? { type: "json_object" } : { type: "json_object" },
      messages: [
        { role: "system", content: systemPromptAbusive },
        { role: "user", content: `Analiza este texto de licitación:\n\n${text.slice(0, 50000)}` }
      ]
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Respuesta vacía");
    return JSON.parse(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Error detectando cláusulas abusivas: ${message}`);
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const input = text.trim();
  if (!input) {
    throw new Error("Texto vacío: no se puede generar embedding");
  }

  const client = new OpenAI({ 
    apiKey: AI_PROVIDER === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY,
    baseURL: AI_PROVIDER === "openrouter" ? OPENROUTER_BASE_URL : undefined
  });

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
    throw new Error(`Error generando embedding con ${AI_PROVIDER.toUpperCase()}: ${message}`);
  }
}
