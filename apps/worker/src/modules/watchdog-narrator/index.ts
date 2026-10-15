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

  // Cambios reconocidos: aviso breve, accionable y sin llamada de IA.
  // No reducir los casos desconocidos: conservan detalle técnico para auditoría.
  if (deterministic.category !== "desconocido") {
    const original = deterministic.text.split("\n");
    const changedIdx = original.indexOf("¿QUÉ PASÓ?");
    const actionIdx = original.indexOf("¿QUÉ DEBO HACER?");
    const what = changedIdx >= 0 ? (original[changedIdx + 1] ?? "") : "";
    const action = actionIdx >= 0 ? (original[actionIdx + 1] ?? "").replace(/^1\.\s*/, "") : "";
    const safe = (value: string) => value
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const labels: Record<string, { icon: string; title: string }> = {
      cambio_estatus: { icon: "🔄", title: "ESTATUS MODIFICADO" },
      fecha_apertura: { icon: "⏰", title: "CAMBIÓ LA APERTURA" },
      fecha_junta: { icon: "🗣", title: "JUNTA DE ACLARACIONES" },
      fecha_fallo: { icon: "📋", title: "NOVEDADES DEL FALLO" },
      documento_nuevo: { icon: "📎", title: "DOCUMENTACIÓN ACTUALIZADA" },
      tabla_modificada: { icon: "🧾", title: "PARTIDAS MODIFICADAS" },
    };
    const label = labels[deterministic.category] ?? { icon: "🔔", title: "CAMBIO DETECTADO" };
    const clean = filterAndDeduplicateChanges(input.changes);
    const lines = [
      `${label.icon} <b>GOSS · ${label.title}</b>`,
      `<b>${safe(input.alias)}</b>`,
      "",
      `📌 ${what}`,
      `✅ <b>Revisar:</b> ${action}`,
    ];
    const dateCategory = ["fecha_apertura", "fecha_junta", "fecha_fallo"].includes(deterministic.category);
    if (dateCategory && clean.length > 0) {
      const date = extractDateFromChange(clean[0]);
      if (date) lines.push(`🕒 <b>Fecha señalada:</b> ${safe(date)}`);
    }
    if (clean.length > 1) lines.push(`📑 ${clean.length} cambios detectados; consultar expediente completo.`);
    if (/^https:\/\//.test(input.expedienteUrl)) {
      lines.push("", `🔗 <a href="${safe(input.expedienteUrl)}"><b>Abrir expediente en ComprasMX</b></a>`);
    }
    return { text: lines.join("\n"), category: deterministic.category };
  }

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
