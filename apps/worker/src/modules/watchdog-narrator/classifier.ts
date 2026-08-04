import type { WatchdogChange } from "../licitacion-watchdog/types";
import type { ClassifierCategory, NarrativeInput } from "./types";

/**
 * Filtra ruido y colapsa pares duplicados (detail vs visibleFields)
 */
export function filterAndDeduplicateChanges(changes: WatchdogChange[]): WatchdogChange[] {
  const filtered: WatchdogChange[] = [];
  const seenPaths = new Set<string>();

  // Reglas de colapso de pares duplicados
  const isDuplicatedPair = (pathA: string, pathB: string): boolean => {
    const normA = pathA.toLowerCase();
    const normB = pathB.toLowerCase();
    if (
      (normA.includes("estatus") && normB.includes("estatus")) ||
      (normA.includes("fecha_apertura") && normB.includes("apertura")) ||
      (normA.includes("junta") && normB.includes("junta")) ||
      (normA.includes("fallo") && normB.includes("fallo"))
    ) {
      return true;
    }
    return false;
  };

  for (const change of changes) {
    const path = change.path || "";
    // Ignorar hashes y deploymentSha
    if (path.includes("deploymentSha") || path.includes("snapshot_hash")) {
      continue;
    }

    // Verificar si ya existe un cambio equivalente en el conjunto acumulado
    let isDuplicate = false;
    for (const existing of filtered) {
      if (isDuplicatedPair(existing.path, path)) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate && !seenPaths.has(path)) {
      seenPaths.add(path);
      filtered.push(change);
    }
  }

  return filtered;
}

/**
 * Clasificador determinista de cambios por categoría
 */
export function classifyChangeCategory(change: WatchdogChange): ClassifierCategory {
  const path = (change.path || "").toLowerCase();
  const docName = change.document?.name?.toLowerCase() || "";

  if (path.includes("estatus")) {
    return "cambio_estatus";
  }
  if (path.includes("fecha_apertura") || path.includes("presentación y apertura") || path.includes("presentacion y apertura")) {
    return "fecha_apertura";
  }
  if (path.includes("junta de aclaraciones") || docName.includes("junta")) {
    return "fecha_junta";
  }
  if (path.includes("fallo") || docName.includes("fallo")) {
    return "fecha_fallo";
  }
  if (path.includes("documents") || path.includes("documentsignature") || change.kind === "document_added" || change.kind === "document_removed") {
    return "documento_nuevo";
  }
  if (path.includes("tablesignatures") || path.includes("visibletables")) {
    return "tabla_modificada";
  }

  return "desconocido";
}

/**
 * Diccionario de significados para estatus de licitación
 */
export function translateStatusMeaning(statusStr: unknown): string {
  const status = String(statusStr || "").toUpperCase().trim();
  if (status.includes("VIGENTE") || status.includes("VIGENTE PAP")) {
    return "todavía se pueden subir propuestas";
  }
  if (status.includes("PENDIENTE DE APERTURA")) {
    return "ya cerró la recepción, falta abrir sobres";
  }
  if (status.includes("EN APERTURA")) {
    return "están abriendo los sobres en este momento";
  }
  if (status.includes("EN FALLO") || status.includes("ADJUDICADA")) {
    return "ya hay ganador";
  }
  if (status.includes("DESIERTA") || status.includes("CANCELADA")) {
    return "el procedimiento se cayó";
  }
  return `el estatus cambió a "${status}"`;
}

export function extractDateFromChange(change: WatchdogChange): string | null {
  const cur = change.current;
  if (typeof cur === "string" && cur.trim().length > 0) {
    const val = cur.trim();
    if (/\d{2,4}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}:\d{2}/.test(val)) {
      return val;
    }
  }
  return null;
}

/**
 * Renderiza el mensaje determinista en lenguaje simple (Plantilla obligatoria)
 */
export function buildDeterministicNarrative(input: NarrativeInput): { text: string; category: ClassifierCategory } {
  const cleanChanges = filterAndDeduplicateChanges(input.changes);
  if (cleanChanges.length === 0) {
    return {
      category: "desconocido",
      text: `🔔 <b>${input.alias}</b>\n────────────────\n¿QUÉ PASÓ?\nSe detectaron ajustes menores sin cambios significativos.\n\n¿QUÉ SIGNIFICA?\nEl expediente se actualizó en la plataforma.\n\n¿QUÉ DEBO HACER?\n1. Revisar el expediente en ComprasMX.\n2. Validar con tu equipo.\n\n⏱ Para cuándo: sin plazo asociado\n🔗 ${input.expedienteUrl}`,
    };
  }

  const primaryChange = cleanChanges[0];
  const category = classifyChangeCategory(primaryChange);

  let quePaso = "";
  let queSignifica = "";
  let queDeboHacer1 = "";
  let queDeboHacer2 = "";
  let paraCuando = "sin plazo asociado";

  const prevVal = String(primaryChange.previous ?? "N/D");
  const curVal = String(primaryChange.current ?? "N/D");
  const extractedDate = extractDateFromChange(primaryChange);
  if (extractedDate) paraCuando = extractedDate;

  switch (category) {
    case "cambio_estatus": {
      const meaning = translateStatusMeaning(curVal);
      quePaso = `El estatus cambió de <b>${prevVal}</b> a <b>${curVal}</b>.`;
      queSignifica = `Significa que ${meaning}.`;
      if (curVal.toUpperCase().includes("PENDIENTE") || curVal.toUpperCase().includes("APERTURA")) {
        queDeboHacer1 = "Verificar que la propuesta haya quedado registrada correctamente.";
        queDeboHacer2 = "Estar atento a la publicación del acta de apertura.";
      } else if (curVal.toUpperCase().includes("FALLO") || curVal.toUpperCase().includes("ADJUDICADA")) {
        queDeboHacer1 = "Descargar el acta de fallo para conocer la resolución y el ganador.";
        queDeboHacer2 = "Revisar los tiempos para posible aclaración o inconformidad.";
      } else {
        queDeboHacer1 = "Revisar la plataforma para confirmar requisitos actualizados.";
        queDeboHacer2 = "Verificar que la documentación cumpla con el nuevo estado.";
      }
      break;
    }
    case "fecha_apertura": {
      quePaso = `Se fijó o actualizó la fecha de presentación y apertura a: <b>${curVal}</b>.`;
      queSignifica = "Define el límite exacto para entregar las propuestas técnica y económica.";
      queDeboHacer1 = "Preparar y firmar la propuesta antes del horario límite.";
      queDeboHacer2 = "Subir los archivos a ComprasMX con anticipación para evitar saturación.";
      break;
    }
    case "fecha_junta": {
      quePaso = `Hay novedades en la Junta de Aclaraciones (fecha/acta): <b>${curVal}</b>.`;
      queSignifica = "Las respuestas de la convocante pueden modificar los anexos o la junta previa.";
      queDeboHacer1 = "Descargar y leer la última junta de aclaraciones.";
      queDeboHacer2 = "Ajustar la propuesta técnica/económica según lo aclarado.";
      break;
    }
    case "fecha_fallo": {
      quePaso = `Se actualizó la fecha o documento de Fallo: <b>${curVal}</b>.`;
      queSignifica = "Se dará a conocer el fallo definitivo y la adjudicación del contrato.";
      queDeboHacer1 = "Consultar el dictamen de evaluación y la adjudicación.";
      queDeboHacer2 = "Si fuiste ganador, preparar la documentación para la firma del contrato.";
      break;
    }
    case "documento_nuevo": {
      const docName = primaryChange.document?.name || "un nuevo documento";
      quePaso = `Se publicó un nuevo documento: <b>${docName}</b>.`;
      queSignifica = "La dependencia agregó anexos o formatos oficiales al expediente.";
      queDeboHacer1 = "Descargar el nuevo archivo y revisar su contenido.";
      queDeboHacer2 = "Confirmar si modifica los formatos que debes presentar.";
      break;
    }
    case "tabla_modificada": {
      quePaso = "Se modificó la tabla de partidas o catálogo de conceptos.";
      queSignifica = "Cambiaron las cantidades, descripciones o partidas a cotizar.";
      queDeboHacer1 = "Revisar el catálogo actualizado en la plataforma.";
      queDeboHacer2 = "Ajustar la cotización y anexos técnicos a las nuevas partidas.";
      break;
    }
    case "desconocido":
    default: {
      quePaso = `Se modificó el campo <code>${primaryChange.path || "general"}</code>.`;
      queSignifica = "Ocurrió una actualización de datos en el expediente.";
      queDeboHacer1 = "Revisar la liga del expediente para ver el detalle.";
      queDeboHacer2 = "Validar si el cambio afecta la licitación.";
      break;
    }
  }

  let text = [
    `🔔 <b>${input.alias}</b>`,
    "────────────────",
    "¿QUÉ PASÓ?",
    quePaso,
    "",
    "¿QUÉ SIGNIFICA?",
    queSignifica,
    "",
    "¿QUÉ DEBO HACER?",
    `1. ${queDeboHacer1}`,
    `2. ${queDeboHacer2}`,
    "",
    `⏱ Para cuándo: ${paraCuando}`,
    `🔗 ${input.expedienteUrl}`,
  ].join("\n");

  if (category === "desconocido") {
    const rawDiffLines = cleanChanges.map(
      (c) => `• ${c.path}: ${JSON.stringify(c.previous)} → ${JSON.stringify(c.current)}`,
    ).join("\n");
    text += `\n\nDetalle técnico:\n${rawDiffLines}`;
  }

  return { text, category };
}
