import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import type { NarrativeInput } from "./types";

const log = createModuleLogger("watchdog-narrator:ai");
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const AI_TIMEOUT_MS = 8000;

export interface AiSections {
  queSignifica: string;
  queDeboHacer: string[];
}

/**
 * Llama a OpenRouter AI si está habilitado en la configuración.
 * Tiempo límite estricto de 8s; si falla o expira, retorna null.
 */
export async function generateAiNarrativeSections(
  input: NarrativeInput,
  quePasoText: string,
): Promise<AiSections | null> {
  const config = getConfig();
  const apiKey = config.OPENROUTER_API_KEY;
  const aiEnabled = config.WATCHDOG_NARRATOR_AI;

  if (!aiEnabled || !apiKey || apiKey.trim().length === 0) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const changesSummary = input.changes
      .map((c) => `${c.path || "campo"}: ${JSON.stringify(c.previous)} -> ${JSON.stringify(c.current)}`)
      .join("; ");

    const userPrompt = `Licitación: ${input.alias}
Cambio detectado: ${quePasoText}
Resumen diff: ${changesSummary}

Genera únicamente un objeto JSON con las claves:
{
  "queSignifica": "1 a 2 frases en español simple explicando por qué importa",
  "queDeboHacer": ["acción 1", "acción 2"]
}`;

    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://radarlicitaciones.mx",
        "X-Title": "Radar Licitaciones MX Watchdog",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini", // o google/gemini-flash-1.5 si OpenRouter
        messages: [
          {
            role: "system",
            content:
              "Eres asistente de un licitante mexicano. Explica en español simple qué implica este cambio y qué debe hacer hoy. Máximo 3 líneas por bloque. No cites leyes. No inventes fechas.",
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      log.warn({ status: response.status }, "OpenRouter respondió con error HTTP");
      return null;
    }

    const data = (await response.json()) as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    if (parsed.queSignifica && Array.isArray(parsed.queDeboHacer) && parsed.queDeboHacer.length >= 2) {
      return {
        queSignifica: String(parsed.queSignifica),
        queDeboHacer: parsed.queDeboHacer.slice(0, 2).map(String),
      };
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      log.info("Llamada a IA cancelada por timeout de 8s; se usa fallback determinista");
    } else {
      log.warn({ err }, "Error procesando narrativa con IA; usando fallback determinista");
    }
  } finally {
    clearTimeout(timeoutId);
  }

  return null;
}
