import { textContainsTerm } from "../../core/text";
import type { NormalizedProcurement } from "../../types/procurement";

export type PriorityAlertProfileId =
  | "capufe_fonadin_peaje_telepeaje"
  | "imss_issste_morelos_laboratorios";

export interface PriorityAlertProfile {
  id: PriorityAlertProfileId;
  label: string;
}

const CAPUFE_FONADIN_PROFILE: PriorityAlertProfile = {
  id: "capufe_fonadin_peaje_telepeaje",
  label: "Mantenimiento Peaje/Telepeaje CAPUFE-FONADIN",
};

const IMSS_ISSSTE_MORELOS_PROFILE: PriorityAlertProfile = {
  id: "imss_issste_morelos_laboratorios",
  label: "Laboratorios IMSS/ISSSTE Morelos",
};

const CAPUFE_FONADIN_ENTITY_TERMS = [
  "capufe",
  "caminos y puentes federales",
  "fonadin",
  "fondo nacional de infraestructura",
  "red capufe",
  "red fonadin",
  "red concesionada fonadin",
];

const CAPUFE_FONADIN_DOMAIN_TERMS = [
  "peaje",
  "telepeaje",
  "plaza de cobro",
  "plazas de cobro",
  "control de transito",
  "equipos de control de transito",
  "mantenimiento preventivo",
  "mantenimiento correctivo",
  "infraestructura de peaje",
  "sistemas de peaje",
  "sistema de peaje",
  "mexico cuernavaca",
  "michapa puebla",
];

const HEALTH_INSTITUTION_TERMS = [
  "imss",
  "instituto mexicano del seguro social",
  "issste",
  "instituto de seguridad y servicios sociales de los trabajadores del estado",
];

const MORELOS_TERMS = [
  "morelos",
  "ooad morelos",
  "organo de operacion administrativa desconcentrada morelos",
  "delegacion estatal morelos",
];

const LABORATORY_DOMAIN_TERMS = [
  "laboratorio clinico",
  "laboratorios clinicos",
  "analisis clinicos",
  "servicio medico integral",
  "servicio integral de laboratorio",
  "servicio subrogado",
  "subrogacion",
  "servicio de transicion",
  "segundo nivel",
  "tercer nivel",
  "reactivos",
  "material de laboratorio",
  "bienes terapeuticos",
  "insumos de laboratorio",
];

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

export function buildPriorityAlertSearchText(procurement: NormalizedProcurement): string {
  const parts = [
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

function hasAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => textContainsTerm(text, term));
}

export function detectPriorityAlertProfile(
  procurement: NormalizedProcurement,
): PriorityAlertProfile | null {
  const text = buildPriorityAlertSearchText(procurement);

  if (
    hasAnyTerm(text, CAPUFE_FONADIN_ENTITY_TERMS) &&
    hasAnyTerm(text, CAPUFE_FONADIN_DOMAIN_TERMS)
  ) {
    return CAPUFE_FONADIN_PROFILE;
  }

  if (
    hasAnyTerm(text, HEALTH_INSTITUTION_TERMS) &&
    hasAnyTerm(text, MORELOS_TERMS) &&
    hasAnyTerm(text, LABORATORY_DOMAIN_TERMS)
  ) {
    return IMSS_ISSSTE_MORELOS_PROFILE;
  }

  return null;
}
