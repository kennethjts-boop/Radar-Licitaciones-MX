import { normalizeText, textContainsTerm } from "../core/text";
import type { NormalizedProcurement } from "../types/procurement";

export const CAPUFE_DIRECT_AWARDS_RADAR_KEY = "capufe_direct_awards";
export const CAPUFE_DIRECT_AWARDS_SCORE_REASONS = [
  "buyer_capufe",
  "procedure_direct_award",
  "priority_capufe_direct_award",
];

export interface CapufeDirectAwardsDetection {
  capufeTerms: string[];
  directAwardTerms: string[];
}

const CAPUFE_INSTITUTIONAL_TERMS = [
  "CAPUFE",
  "Caminos y Puentes Federales",
  "Caminos y Puentes Federales de Ingresos y Servicios Conexos",
  "Caminos y Puentes Federales de Ingresos y Servicios Conexos CAPUFE",
  "Gerencia de Tramo CAPUFE",
  "Delegacion Regional CAPUFE",
  "Plaza de Cobro CAPUFE",
  "Red CAPUFE",
  "Autopista operada por CAPUFE",
  "Caminos y Puentes",
  "Puentes Federales de Ingresos",
  "Servicios Conexos",
];

const CAPUFE_CONTEXT_TERMS = [
  "plaza de cobro",
  "caseta de cobro",
  "autopista",
  "tramo carretero",
  "peaje",
  "telepeaje",
  "carril",
  "cabina de cobro",
  "sistema de cobro",
  "mantenimiento de plaza de cobro",
  "operacion de casetas",
];

const DIRECT_AWARD_TEXT_TERMS = [
  "adjudicacion directa",
  "procedimiento de adjudicacion directa",
  "contratacion por adjudicacion directa",
  "compra por adjudicacion directa",
  "adjudicado directamente",
  "adjudicada directamente",
  "tipo de procedimiento adjudicacion directa",
  "tipo procedimiento adjudicacion directa",
  "caracter del procedimiento adjudicacion directa",
  "excepcion a licitacion publica",
  "excepcion a la licitacion publica",
  "contratacion directa",
  "asignacion directa",
  "sin licitacion publica",
];

const DIRECT_AWARD_PROCEDURE_FIELD_TERMS = [
  ...DIRECT_AWARD_TEXT_TERMS,
  "directa",
  "ad",
];

const PROCEDURE_FIELD_KEY_PATTERN =
  /(tipo|procedimiento|caracter|forma|modalidad|contrataci[oó]n|adjudicaci[oó]n|numero|n[uú]mero|expediente)/i;

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

function collectProcedureFieldParts(
  value: unknown,
  parts: string[],
  depth = 0,
  parentKey = "",
): void {
  if (value === null || value === undefined || depth > 5) return;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (PROCEDURE_FIELD_KEY_PATTERN.test(parentKey)) {
      parts.push(String(value));
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectProcedureFieldParts(item, parts, depth + 1, parentKey);
    return;
  }

  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      collectProcedureFieldParts(nested, parts, depth + 1, key);
    }
  }
}

export function buildCapufeDirectAwardSearchText(procurement: NormalizedProcurement): string {
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
    procurement.procedureType,
    procurement.canonicalText,
  ];

  for (const attachment of procurement.attachments) {
    parts.push(attachment.fileName);
    parts.push(attachment.detectedText ?? "");
  }

  collectTextParts(procurement.rawJson, parts);

  return parts.filter(Boolean).join(" | ");
}

function buildProcedureFieldText(procurement: NormalizedProcurement): string {
  const parts = [
    procurement.procedureType,
    procurement.procedureNumber ?? "",
    procurement.licitationNumber ?? "",
    procurement.expedienteId ?? "",
  ];

  collectProcedureFieldParts(procurement.rawJson, parts);

  return parts.filter(Boolean).join(" | ");
}

function detectCapufeTerms(text: string): string[] {
  const institutionalMatches = CAPUFE_INSTITUTIONAL_TERMS.filter((term) =>
    textContainsTerm(text, term),
  );
  if (institutionalMatches.length === 0) return [];

  const contextMatches = CAPUFE_CONTEXT_TERMS.filter((term) =>
    textContainsTerm(text, term),
  );

  return [...new Set([...institutionalMatches, ...contextMatches])];
}

function detectDirectAwardTerms(procurement: NormalizedProcurement, text: string): string[] {
  const matches = new Set<string>();

  if (procurement.procedureType === "adjudicacion_directa") {
    matches.add("adjudicacion_directa");
  }

  for (const term of DIRECT_AWARD_TEXT_TERMS) {
    if (textContainsTerm(text, term)) {
      matches.add(term);
    }
  }

  const procedureFieldText = buildProcedureFieldText(procurement);
  for (const term of DIRECT_AWARD_PROCEDURE_FIELD_TERMS) {
    if (textContainsTerm(procedureFieldText, term)) {
      matches.add(term);
    }
  }

  return [...matches];
}

export function detectCapufeDirectAward(
  procurement: NormalizedProcurement,
): CapufeDirectAwardsDetection | null {
  if (procurement.source !== "comprasmx") return null;

  const text = buildCapufeDirectAwardSearchText(procurement);
  const capufeTerms = detectCapufeTerms(text);
  if (capufeTerms.length === 0) return null;

  const directAwardTerms = detectDirectAwardTerms(procurement, normalizeText(text));
  if (directAwardTerms.length === 0) return null;

  return {
    capufeTerms,
    directAwardTerms,
  };
}
