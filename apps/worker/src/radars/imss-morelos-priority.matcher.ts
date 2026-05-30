import { normalizeText, textContainsTerm } from "../core/text";
import type { NormalizedProcurement } from "../types/procurement";

export const IMSS_MORELOS_RADAR_KEY = "imss_morelos";
export const IMSS_MORELOS_SCORE_REASONS = [
  "buyer_imss",
  "territory_morelos",
  "priority_institutional_radar",
];

export const IMSS_BIENESTAR_EXCLUSION_TERMS = [
  "IMSS-Bienestar",
  "IMSS Bienestar",
  "Servicios de Salud IMSS-Bienestar",
  "Servicios de Salud IMSS Bienestar",
  "OPD IMSS-Bienestar",
  "OPD IMSS Bienestar",
  "Organismo Publico Descentralizado IMSS-Bienestar",
  "Organismo Publico Descentralizado IMSS Bienestar",
  "IMSS-Bienestar Morelos",
  "IMSS Bienestar Morelos",
];

export interface ImssMorelosPriorityDetection {
  imssTerms: string[];
  territoryTerms: string[];
  territoryMatched: string;
}

const IMSS_INSTITUTIONAL_TERMS = [
  "instituto mexicano del seguro social",
  "ooad morelos",
  "organo de operacion administrativa desconcentrada estatal morelos",
  "organo de operacion administrativa desconcentrada del imss en morelos",
  "organo de operacion administrativa desconcentrada regional morelos",
  "delegacion morelos imss",
  "representacion morelos imss",
  "imss morelos",
  "hospital general de zona del imss",
  "unidad de medicina familiar del imss",
  "umf imss",
  "hgz imss",
  "hgr imss",
];

const SEGURO_SOCIAL_CONTEXT_TERMS = [
  "imss",
  "instituto mexicano del seguro social",
  "ooad",
  "organo de operacion administrativa desconcentrada",
  "unidad de medicina familiar",
  "unidad medica familiar",
  "unidades medicas",
  "hospital general de zona",
  "umf",
  "hgz",
  "hgr",
];

export const MORELOS_TERRITORY_TERMS = [
  "Morelos",
  "Cuernavaca",
  "Jiutepec",
  "Temixco",
  "Cuautla",
  "Jojutla",
  "Zacatepec",
  "Tlaltizapan",
  "Yautepec",
  "Emiliano Zapata",
  "Xochitepec",
  "Puente de Ixtla",
  "Tlaquiltenango",
  "Huitzilac",
  "Yecapixtla",
  "Axochiapan",
  "Ayala",
  "Tepoztlan",
  "Tlayacapan",
  "Tetecala",
  "Miacatlan",
  "Mazatepec",
  "Ocuituco",
  "Tepalcingo",
  "Temoac",
  "Totolapan",
  "Atlatlahucan",
  "Coatlan del Rio",
  "Amacuzac",
  "Jonacatepec",
  "Jantetelco",
  "Tlalnepantla Morelos",
];

function foldedLower(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function hasImssAcronym(text: string): boolean {
  return /\bi\s*\.?\s*m\s*\.?\s*s\s*\.?\s*s\b/i.test(foldedLower(text));
}

function collectTextParts(value: unknown, parts: string[], depth = 0): void {
  if (value === null || value === undefined || depth > 5) return;

  if (typeof value === "string") {
    parts.push(value);
    return;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    parts.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectTextParts(item, parts, depth + 1);
    return;
  }

  if (typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectTextParts(nested, parts, depth + 1);
    }
  }
}

export function buildImssMorelosSearchText(procurement: NormalizedProcurement): string {
  const parts: string[] = [
    procurement.title,
    procurement.description ?? "",
    procurement.dependencyName ?? "",
    procurement.buyingUnit ?? "",
    procurement.state ?? "",
    procurement.municipality ?? "",
    procurement.expedienteId ?? "",
    procurement.licitationNumber ?? "",
    procurement.procedureNumber ?? "",
    procurement.canonicalText,
  ];

  for (const attachment of procurement.attachments) {
    parts.push(attachment.fileName);
    parts.push(attachment.detectedText ?? "");
  }

  collectTextParts(procurement.rawJson, parts);

  return parts.filter(Boolean).join(" | ");
}

function detectImssTerms(text: string): string[] {
  const matches = new Set<string>();

  if (hasImssAcronym(text)) {
    matches.add("IMSS");
  }

  for (const term of IMSS_INSTITUTIONAL_TERMS) {
    if (textContainsTerm(text, term)) {
      matches.add(term);
    }
  }

  const hasSeguroSocial = textContainsTerm(text, "seguro social");
  if (hasSeguroSocial) {
    const hasInstitutionalContext =
      hasImssAcronym(text) ||
      SEGURO_SOCIAL_CONTEXT_TERMS.some((term) => textContainsTerm(text, term));

    if (hasInstitutionalContext) {
      matches.add("Seguro Social");
    }
  }

  return [...matches];
}

function detectTerritoryTerms(text: string): string[] {
  const normalized = normalizeText(text);
  return MORELOS_TERRITORY_TERMS.filter((term) =>
    textContainsTerm(normalized, term),
  );
}

function isImssBienestar(text: string): boolean {
  return IMSS_BIENESTAR_EXCLUSION_TERMS.some((term) =>
    textContainsTerm(text, term),
  );
}

export function detectImssMorelosPriority(
  procurement: NormalizedProcurement,
): ImssMorelosPriorityDetection | null {
  if (procurement.source !== "comprasmx") return null;

  const text = buildImssMorelosSearchText(procurement);
  if (isImssBienestar(text)) return null;

  const imssTerms = detectImssTerms(text);
  if (imssTerms.length === 0) return null;

  const territoryTerms = detectTerritoryTerms(text);
  if (territoryTerms.length === 0) return null;

  return {
    imssTerms,
    territoryTerms,
    territoryMatched: territoryTerms[0],
  };
}
