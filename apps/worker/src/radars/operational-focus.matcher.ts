import { normalizeText } from "../core/text";
import type { NormalizedProcurement } from "../types/procurement";

/** Stable identities for the October strategy. Oaxtepec retains its historical ID. */
export const OPERATIONAL_FOCUS_KEYS = {
  capufeSecurity: "capufe_seguridad_20261014",
  capufeEmergencyVehicles: "capufe_emergencia_vehiculos_20261014",
  capufeAdministrativeVehicles: "capufe_vehiculos_administrativos_20261014",
  capufeGeneralCleaning: "capufe_limpieza_general_20261014",
  capufeFurniture: "capufe_mobiliario_20261014",
  capufeSpecialNationalCleaning: "capufe_limpieza_especial_nacional_20261014",
  imssCleaning: "imss_limpieza_20261014",
  imssSecurity: "imss_seguridad_20261014",
  imssClinicalLaboratory: "imss_laboratorio_clinico_20261014",
  imssBloodBank: "imss_banco_sangre_20261014",
  imssOaxtepec: "imss_bienestar_morelos",
} as const;

export type OperationalFocusKey = (typeof OPERATIONAL_FOCUS_KEYS)[keyof typeof OPERATIONAL_FOCUS_KEYS];
export interface OperationalFocusDetection {
  matchedTerms: string[];
  scoreReasons: string[];
  territoryMatched: string | null;
}

function raw(procurement: NormalizedProcurement, key: string): string {
  const value = procurement.rawJson[key];
  return typeof value === "string" ? normalizeText(value) : "";
}
function dependency(procurement: NormalizedProcurement): string {
  return raw(procurement, "siglas") || raw(procurement, "dependencia") ||
    normalizeText(procurement.dependencyName ?? "");
}
function buyingUnit(procurement: NormalizedProcurement): string {
  return raw(procurement, "unidad_compradora") || normalizeText(procurement.buyingUnit ?? "");
}
function contractObject(procurement: NormalizedProcurement): string {
  return normalizeText([
    procurement.title,
    procurement.description,
    raw(procurement, "objeto_contratacion"),
  ].filter(Boolean).join(" "));
}
function matches(text: string, pattern: RegExp): boolean { return pattern.test(text); }
function isCapufe(procurement: NormalizedProcurement): boolean {
  return matches(dependency(procurement), /^(?:capufe|caminos y puentes federales(?: de ingresos y servicios conexos)?)$/);
}
function isImss(procurement: NormalizedProcurement): boolean {
  const name = dependency(procurement);
  return !matches([name, raw(procurement, "dependencia"), normalizeText(procurement.dependencyName ?? "")].join(" "), /bienestar/) &&
    matches(name, /^(?:imss|instituto mexicano del seguro social)$/);
}

const SERVICE = /\b(?:servicio|servicios|contratacion|prestacion)\b/;
const CLEANING = /\b(?:limpieza|aseo|higienizacion|sanitizacion)\b/;
const CLEANING_SUPPLIES = /\b(?:materiales?|insumos?|productos?|articulos?|quimicos?|detergentes?|jabones?|utensilios?)\s+(?:de|para)\s+(?:la\s+)?limpieza\b/;
const SECURITY_PEOPLE = /\b(?:guardias?|vigilantes?|personal de seguridad|seguridad privada|seguridad y vigilancia|servicio de vigilancia|vigilancia presencial|resguardo de instalaciones)\b/;
const ELECTRONIC_SECURITY = /\b(?:videovigilancia|video vigilancia|cctv|circuito cerrado|camaras?|alarmas?|monitoreo electronico|sistema de vigilancia|equipo de vigilancia)\b/;
const MAINTENANCE = /\b(?:mantenimiento|reparacion|refacciones?|partes|piezas|rehabilitacion)\b/;
const ACQUISITION = /\b(?:adquisicion|compra|suministro|arrendamiento|equipamiento|dotacion)\b/;

function matchesObject(key: OperationalFocusKey, procurement: NormalizedProcurement): boolean {
  const title = contractObject(procurement);
  if (!title) return false;
  switch (key) {
    case OPERATIONAL_FOCUS_KEYS.capufeSecurity:
    case OPERATIONAL_FOCUS_KEYS.imssSecurity:
      return matches(title, SECURITY_PEOPLE) &&
        (!matches(title, ELECTRONIC_SECURITY) ||
          matches(title, /\b(?:guardias?|vigilantes?|personal de seguridad|seguridad privada|vigilancia presencial)\b/));
    case OPERATIONAL_FOCUS_KEYS.capufeEmergencyVehicles:
      return matches(title, /\b(?:ambulancias?|vehiculos? de emergencia|unidades? de emergencia|vehiculos? de auxilio vial|unidades? de auxilio vial|gruas? de arrastre|vehiculos? de rescate|unidades? de rescate|patrullas? de auxilio)\b/) &&
        !matches(title, MAINTENANCE);
    case OPERATIONAL_FOCUS_KEYS.capufeAdministrativeVehicles:
      return matches(title, /\b(?:vehiculos? administrativos?|parque vehicular administrativo|automoviles?|camionetas?|pick ups?|vehiculos? utilitarios?|vehiculos? de transporte administrativo)\b/) &&
        !matches(title, /\b(?:ambulancias?|emergencia|auxilio vial|rescate)\b/) &&
        !matches(title, MAINTENANCE);
    case OPERATIONAL_FOCUS_KEYS.capufeGeneralCleaning:
      return matches(title, SERVICE) && matches(title, CLEANING) &&
        matches(title, /\b(?:integral|general|instalaciones|oficinas|inmuebles|plazas de cobro)\b/) &&
        !matches(title, CLEANING_SUPPLIES) &&
        !matches(title, /\b(?:especial|especializado|extraordinari[ao])\b/);
    case OPERATIONAL_FOCUS_KEYS.capufeFurniture:
      return matches(title, /\b(?:mobiliario|muebles? de oficina|sillas?|escritorios?|archiveros?|mesas? de trabajo|equipamiento de oficinas?)\b/) &&
        (!matches(title, MAINTENANCE) || matches(title, ACQUISITION)) &&
        !matches(title, /\b(?:refacciones?|reparacion)\b/);
    case OPERATIONAL_FOCUS_KEYS.capufeSpecialNationalCleaning: {
      const scope = [title, raw(procurement, "alcance"), raw(procurement, "cobertura")].join(" ");
      return matches(title, SERVICE) && matches(title, CLEANING) &&
        matches(title, /\b(?:especial|especializado|extraordinari[ao]|profunda)\b/) &&
        (matches(scope, /\b(?:alcance nacional|cobertura nacional|a nivel nacional|red nacional|toda la red|todo el territorio nacional|toda la republica|diversas delegaciones|varias delegaciones)\b/) ||
          matches(title, /\b(?:limpieza|aseo).{0,60}\bnacional\b/)) &&
        !matches(title, CLEANING_SUPPLIES);
    }
    case OPERATIONAL_FOCUS_KEYS.imssCleaning:
      return matches(title, SERVICE) && matches(title, CLEANING) && !matches(title, CLEANING_SUPPLIES);
    case OPERATIONAL_FOCUS_KEYS.imssClinicalLaboratory:
      return matches(title, SERVICE) &&
        matches(title, /\b(?:laboratorio clinico|estudios de laboratorio|analisis clinicos|pruebas de laboratorio clinico)\b/) &&
        !matches(title, /\b(?:reactivos?|insumos?|materiales?|equipos?)\s+(?:de|para)\s+(?:laboratorio|analisis)\b/);
    case OPERATIONAL_FOCUS_KEYS.imssBloodBank:
      return matches(title, SERVICE) &&
        matches(title, /\b(?:banco de sangre|medicina transfusional|servicio transfusional|hemoterapia|procesamiento de sangre)\b/) &&
        !matches(title, /\b(?:bolsas?|reactivos?|insumos?|materiales?)\s+(?:de|para)\s+(?:banco de sangre|sangre)\b/);
    default:
      return false;
  }
}

export function detectOperationalFocus(
  procurement: NormalizedProcurement,
  radarKey: string,
): OperationalFocusDetection | null {
  if (procurement.source !== "comprasmx") return null;
  if (!Object.values(OPERATIONAL_FOCUS_KEYS).includes(radarKey as OperationalFocusKey)) return null;
  const key = radarKey as OperationalFocusKey;
  const capufe = key.startsWith("capufe_");
  if (capufe ? !isCapufe(procurement) : !isImss(procurement)) return null;
  if (key === OPERATIONAL_FOCUS_KEYS.imssOaxtepec) {
    if (!/\b050gyr085\b/.test(buyingUnit(procurement))) return null;
    return {
      matchedTerms: ["IMSS", "050GYR085"],
      scoreReasons: ["buyer_imss_structured", "buying_unit_050gyr085"],
      territoryMatched: "Oaxtepec, Morelos",
    };
  }
  if (!matchesObject(key, procurement)) return null;
  return {
    matchedTerms: [capufe ? "CAPUFE" : "IMSS", contractObject(procurement)],
    scoreReasons: [capufe ? "buyer_capufe_structured" : "buyer_imss_structured", `object_${key}`],
    territoryMatched: "Nacional",
  };
}
