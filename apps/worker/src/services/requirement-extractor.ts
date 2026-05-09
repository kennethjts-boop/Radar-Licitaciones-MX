/**
 * REQUIREMENT EXTRACTOR — Extrae requisitos técnicos, económicos y legales.
 * Función pura: sin I/O ni dependencias de red.
 */

export type RequirementCategory = "tecnico" | "economico" | "legal";
export type RequirementConfidence = "alta" | "media" | "baja";

export interface ExtractedRequirement {
  category: RequirementCategory;
  text: string;
  confidence: RequirementConfidence;
  matchedKeywords: string[];
  sourceExcerpt: string;
}

export interface RequirementExtractionResult {
  requirements: ExtractedRequirement[];
  counts: Record<RequirementCategory, number>;
  hasRequirements: boolean;
}

const CATEGORY_KEYWORDS: Record<RequirementCategory, string[]> = {
  tecnico: [
    "anexo tecnico",
    "especificaciones tecnicas",
    "terminos de referencia",
    "experiencia tecnica",
    "personal tecnico",
    "equipo minimo",
    "capacidad tecnica",
    "cumplimiento tecnico",
  ],
  economico: [
    "propuesta economica",
    "oferta economica",
    "precio unitario",
    "catalogo de conceptos",
    "garantia de seriedad",
    "fianza",
    "presupuesto",
    "monto",
  ],
  legal: [
    "acta constitutiva",
    "poder notarial",
    "opinion de cumplimiento",
    "sat",
    "imss",
    "infonavit",
    "declaracion de integridad",
    "no inhabilitado",
  ],
};

const REQUIREMENT_MARKERS = [
  "debera",
  "deben",
  "requisito",
  "presentar",
  "acreditar",
  "entregar",
  "contar con",
  "cumplir con",
  "se requiere",
  "obligatorio",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function splitCandidateSentences(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split(/(?:\n+|(?<=[.;:])\s+)/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 24 && s.length <= 800);
}

function confidenceFor(matches: string[], normalizedSentence: string): RequirementConfidence {
  const hasMarker = REQUIREMENT_MARKERS.some((m) => normalizedSentence.includes(m));
  if (matches.length >= 2 || (matches.length === 1 && hasMarker)) return "alta";
  if (matches.length === 1) return "media";
  return "baja";
}

export function extractRequirements(text: string, limitPerCategory = 8): RequirementExtractionResult {
  const counts: Record<RequirementCategory, number> = {
    tecnico: 0,
    economico: 0,
    legal: 0,
  };

  if (!text.trim()) {
    return { requirements: [], counts, hasRequirements: false };
  }

  const requirements: ExtractedRequirement[] = [];
  const seen = new Set<string>();

  for (const sentence of splitCandidateSentences(text)) {
    const normalizedSentence = normalize(sentence);
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [RequirementCategory, string[]][]) {
      if (counts[category] >= limitPerCategory) continue;
      const matchedKeywords = keywords.filter((kw) => normalizedSentence.includes(normalize(kw)));
      const hasRequirementMarker = REQUIREMENT_MARKERS.some((m) => normalizedSentence.includes(m));
      if (matchedKeywords.length === 0 || !hasRequirementMarker) continue;

      const dedupeKey = `${category}:${normalizedSentence.slice(0, 180)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      counts[category]++;
      requirements.push({
        category,
        text: sentence.slice(0, 500),
        confidence: confidenceFor(matchedKeywords, normalizedSentence),
        matchedKeywords,
        sourceExcerpt: sentence.slice(0, 260),
      });
    }
  }

  return {
    requirements,
    counts,
    hasRequirements: requirements.length > 0,
  };
}
