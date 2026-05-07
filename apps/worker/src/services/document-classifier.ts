/**
 * DOCUMENT CLASSIFIER — Clasifica un documento en 14 tipos por keyword matching.
 * Función pura: sin I/O, sin efectos secundarios.
 */
import { createModuleLogger } from "../core/logger";

const log = createModuleLogger("document-classifier");

export type DocumentType =
  | "convocatoria"
  | "bases"
  | "anexo_tecnico"
  | "anexo_economico"
  | "contrato"
  | "acta_apertura"
  | "fallo"
  | "catalogo_conceptos"
  | "propuesta_tecnica"
  | "propuesta_economica"
  | "junta_aclaraciones"
  | "invitacion"
  | "dictamen"
  | "otro";

export type ConfidenceLevel = "alta" | "media" | "baja";

export interface ClassifyInput {
  text: string;
  fileName?: string;
  documentHint?: string;
}

export interface ClassifyResult {
  documentType: DocumentType;
  confidence: ConfidenceLevel;
  matchedKeywords: string[];
}

const KEYWORD_MAP: Record<Exclude<DocumentType, "otro">, string[]> = {
  convocatoria: ["convocatoria", "invitacion a cuando menos"],
  bases: ["bases de licitacion", "terminos de referencia", "especificaciones generales"],
  anexo_tecnico: ["anexo tecnico", "terminos de referencia tecnico", "especificaciones tecnicas"],
  anexo_economico: ["anexo economico", "precios unitarios", "presupuesto base"],
  contrato: ["contrato de", "convenio de", "pedido numero", "orden de compra"],
  acta_apertura: ["acta de apertura", "apertura de propuestas", "apertura tecnica"],
  fallo: ["fallo de adjudicacion", "resultado de la licitacion", "empresa adjudicada", "beneficiaria"],
  catalogo_conceptos: ["catalogo de conceptos", "presupuesto de obra", "volumen de obra", "catalogo de"],
  propuesta_tecnica: ["propuesta tecnica", "oferta tecnica", "solucion tecnica"],
  propuesta_economica: ["propuesta economica", "oferta economica", "precio total ofertado"],
  junta_aclaraciones: ["junta de aclaraciones", "preguntas y respuestas"],
  invitacion: ["carta de invitacion", "invitacion a participar"],
  dictamen: ["dictamen de evaluacion", "evaluacion tecnica", "analisis de propuestas"],
};

const HINT_TYPE_MAP: Record<string, DocumentType> = {
  convocatoria: "convocatoria",
  anexo_tecnico: "anexo_tecnico",
  anexo_economico: "anexo_economico",
  fallo: "fallo",
  contrato: "contrato",
};

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function classifyDocument(input: ClassifyInput): ClassifyResult {
  const normalized = normalizeText(`${input.text} ${input.fileName ?? ""}`);

  let bestType: DocumentType = "otro";
  let bestCount = 0;
  let bestKeywords: string[] = [];

  for (const [docType, keywords] of Object.entries(KEYWORD_MAP) as [Exclude<DocumentType, "otro">, string[]][]) {
    const matched = keywords.filter((kw) => normalizeText(kw).split(" ").every((word) => normalized.includes(word)));
    if (matched.length > bestCount) {
      bestCount = matched.length;
      bestType = docType;
      bestKeywords = matched;
    }
  }

  const hintMatchesType = input.documentHint !== undefined && HINT_TYPE_MAP[input.documentHint] === bestType;

  let confidence: ConfidenceLevel;
  if (bestCount >= 2 || (bestCount >= 1 && hintMatchesType)) {
    confidence = "alta";
  } else if (bestCount === 1) {
    confidence = "media";
  } else {
    confidence = "baja";
  }

  log.info({ documentType: bestType, confidence, matchedKeywords: bestKeywords }, "Documento clasificado");

  return { documentType: bestType, confidence, matchedKeywords: bestKeywords };
}
