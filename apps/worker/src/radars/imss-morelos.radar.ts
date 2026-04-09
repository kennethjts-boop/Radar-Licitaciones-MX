/**
 * RADAR: imss_morelos
 * Detecta licitaciones del IMSS en el estado de Morelos (OOAD Morelos).
 */
import type { RadarConfig } from "../types/procurement";

export const imssMorelosRadar: RadarConfig = {
  key: "imss_morelos",
  name: "IMSS — Delegación Morelos (OOAD)",
  description:
    "Detecta licitaciones del IMSS específicas para la delegación o OOAD Morelos: hospitales, UMF, mantenimiento y suministros.",
  isActive: true,
  priority: 1,
  scheduleMinutes: 30,
  minScore: 0.35,

  includeTerms: [
    // Institucional IMSS
    "imss",
    "instituto mexicano del seguro social",
    "ooad morelos",
    "delegacion morelos",
    "delegación morelos",
    "morelos",

    // Unidades médicas
    "hospital general zona",
    "unidad medica familiar",
    "unidad médica familiar",
    "umf",
    "hgz",
    "hospital de zona",

    // Servicios hospitalarios
    "mantenimiento",
    "mantenimiento preventivo",
    "mantenimiento correctivo",
    "medicamentos",
    "medicamento",
    "material de curación",
    "material de curacion",
    "equipo médico",
    "equipo medico",
    "instrumental médico",
    "reactivos",

    // Servicios generales hospitalarios
    "limpieza hospitalaria",
    "servicios de limpieza",
    "vigilancia",
    "trabajo social",
    "archivo clínico",
    "archivo clinico",
    "impresos",
    "mobiliario hospitalario",
    "mobiliario",

    // Servicios de soporte
    "lavanderia",
    "lavandería",
    "servicios de lavanderia",
    "alimentos",
    "servicio de alimentacion",
    "gases medicinales",
    "oxígeno",
    "oxigeno",
    "ambulancias",
    "transporte",

    // Infraestructura
    "obra",
    "construccion",
    "remodelacion",
    "laboratorio clinico",
    "laboratorio clínico",
  ],

  excludeTerms: [],

  geoTerms: [
    "morelos",
    "cuernavaca",
    "jiutepec",
    "cuautla",
    "temixco",
    "jojutla",
    "puente de ixtla",
  ],

  entityTerms: ["imss", "instituto mexicano del seguro social", "ooad morelos"],

  rules: [
    {
      ruleType: "entity",
      fieldName: "dependency_name",
      operator: "contains",
      value: "imss",
      weight: 0.4,
      isRequired: true,
    },
    {
      ruleType: "geo",
      fieldName: "canonical_text",
      operator: "any_of",
      value: ["morelos", "ooad morelos", "delegacion morelos"],
      weight: 0.6,
      isRequired: false,
    },
  ],
};
