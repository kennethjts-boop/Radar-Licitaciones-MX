/**
 * RADAR: habitat_morelos
 * Radar parametrizable para programas Hábitat y vivienda en Morelos.
 * Pensado para afinar con mayor precisión institucional en fases posteriores.
 */
import type { RadarConfig } from "../types/procurement";

export const habitatMorelosRadar: RadarConfig = {
  key: "habitat_morelos",
  name: "Hábitat — Morelos (Programas de Mejoramiento Urbano)",
  description:
    "Detecta licitaciones de programas Hábitat, mejoramiento urbano y desarrollo comunitario en el estado de Morelos. " +
    "Radar parametrizable — configurar aliases institucionales más precisos en Fase 4.",
  isActive: true,
  priority: 3,
  scheduleMinutes: 30,
  minScore: 0.3,

  includeTerms: [
    // Programa Hábitat
    "habitat",
    "hábitat",
    "programa habitat",
    "programa hábitat",
    "mejoramiento urbano",
    "mejoramiento de barrios",
    "rescate de espacios publicos",
    "rescate de espacios públicos",
    "espacios publicos",
    "parques y jardines",

    // Desarrollo comunitario
    "desarrollo comunitario",
    "comunidad",
    "poligono habitat",
    "polígono hábitat",

    // SEDATU / SEDESOL relacionados
    "sedatu",
    "sedesol",
    "secretaria de desarrollo urbano",
    "secretaría de desarrollo urbano",

    // Obras de mejoramiento
    "banquetas",
    "guarniciones",
    "drenaje",
    "alumbrado",
    "alumbrado publico",
    "pavimentacion",
    "pavimentación",
    "obra urbana",

    // Morelos específico
    "morelos",
    "cuernavaca",
    "municipio de morelos",
  ],

  excludeTerms: ["autopista", "carretera federal", "peaje"],

  geoTerms: [
    "morelos",
    "cuernavaca",
    "cuautla",
    "jiutepec",
    "temixco",
    "emiliano zapata",
    "xochitepec",
    "ayala",
    "zacatepec",
    "jojutla",
    "puente de ixtla",
  ],

  entityTerms: [
    "sedatu",
    "sedesol",
    "habitat",
    // NOTE: Afinar con entidades exactas de Morelos en Fase 4
  ],

  rules: [
    {
      ruleType: "geo",
      fieldName: "canonical_text",
      operator: "contains",
      value: "morelos",
      weight: 0.4,
      isRequired: false,
    },
    {
      ruleType: "keyword",
      fieldName: "canonical_text",
      operator: "any_of",
      value: [
        "habitat",
        "mejoramiento urbano",
        "espacios publicos",
        "pavimentacion",
        "alumbrado",
        "banquetas",
      ],
      weight: 0.6,
      isRequired: true,
    },
  ],
};
