import { buildDeterministicNarrative, extractDateFromChange, filterAndDeduplicateChanges } from "./classifier";
import { generateAiNarrativeSections } from "./ai-narrator";
import type { NarrativeInput, RenderedNarrative } from "./types";

export * from "./types";
export * from "./classifier";
export * from "./ai-narrator";

/** Máximo de líneas del bloque "Detalle técnico" para no exceder el límite de Telegram. */
const MAX_TECHNICAL_DETAIL_LINES = 20;

/**
 * Formatea una alerta del watchdog usando el traductor narrativo.
 * Si IA está activa y disponible en <=8s, enriquece las secciones "¿QUÉ SIGNIFICA?" y "¿QUÉ DEBO HACER?".
 * De lo contrario, utiliza el motor determinista.
 */
export async function formatWatchdogNarrative(input: NarrativeInput): Promise<RenderedNarrative> {
  const deterministic = buildDeterministicNarrative(input);

  // Extraer las líneas base del mensaje determinista
  const lines = deterministic.text.split("\n");
  const quePasoIdx = lines.findIndex((l) => l === "¿QUÉ PASÓ?");
  const quePasoText = quePasoIdx >= 0 && lines[quePasoIdx + 1] ? lines[quePasoIdx + 1] : "";

  // Intentar enriquecimiento opcional con IA
  const aiSections = await generateAiNarrativeSections(input, quePasoText);
  if (!aiSections) {
    return deterministic;
  }

  // Sustituir en la plantilla obligatoria las dos secciones
  const cleanChanges = filterAndDeduplicateChanges(input.changes);
  const primaryChange = cleanChanges[0];
  let paraCuando = "sin plazo asociado";
  if (primaryChange) {
    const extractedDate = extractDateFromChange(primaryChange);
    if (extractedDate) paraCuando = extractedDate;
  }

  const aiRenderedText = [
    `🔔 <b>${input.alias}</b>`,
    "────────────────",
    "¿QUÉ PASÓ?",
    quePasoText,
    "",
    "¿QUÉ SIGNIFICA?",
    aiSections.queSignifica,
    "",
    "¿QUÉ DEBO HACER?",
    `1. ${aiSections.queDeboHacer[0] || "Revisar el expediente en ComprasMX."}`,
    `2. ${aiSections.queDeboHacer[1] || "Validar requerimientos actualizados."}`,
    "",
    `⏱ Para cuándo: ${paraCuando}`,
    `🔗 ${input.expedienteUrl}`,
  ].join("\n");

  let finalResultText = aiRenderedText;
  if (deterministic.category === "desconocido") {
    const allDiffLines = cleanChanges.map(
      (c) => `• ${c.path}: ${JSON.stringify(c.previous)} → ${JSON.stringify(c.current)}`,
    );
    const truncated = allDiffLines.length > MAX_TECHNICAL_DETAIL_LINES;
    const shownLines = truncated
      ? allDiffLines.slice(0, MAX_TECHNICAL_DETAIL_LINES)
      : allDiffLines;
    const header = truncated
      ? `Detalle técnico (primeros ${MAX_TECHNICAL_DETAIL_LINES} de ${allDiffLines.length}):`
      : "Detalle técnico:";
    finalResultText += `\n\n${header}\n${shownLines.join("\n")}`;
  }

  return {
    text: finalResultText,
    category: deterministic.category,
  };
}
