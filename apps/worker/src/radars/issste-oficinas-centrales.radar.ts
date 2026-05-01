/**
 * RADAR: issste_oficinas_centrales
 * Detecta licitaciones del ISSSTE para oficinas centrales y servicios administrativos.
 */
import type { RadarConfig } from "../types/procurement";

export const isssteoOficinasCentralesRadar: RadarConfig = {
  key: "issste_oficinas_centrales",
  name: "ISSSTE — Oficinas Centrales y Servicios Administrativos",
  description:
    "Detecta licitaciones del ISSSTE para sus oficinas centrales, corporativo y unidades administrativas centrales.",
  isActive: true,
  priority: 1,
  scheduleMinutes: 30,
  minScore: 0.35,

  includeTerms: [
    // Institucional
    "issste",
    "instituto de seguridad y servicios sociales de los trabajadores del estado",
    "oficinas centrales",
    "administración central",
    "administracion central",
    "corporativo",
    "sede issste",
    "dirección general",
    "direccion general",

    // Servicios de oficina
    "servicios administrativos",
    "mantenimiento de oficinas",
    "mantenimiento preventivo",
    "mantenimiento correctivo",
    "mobiliario",
    "mobiliario de oficina",

    // Tecnología
    "licencias",
    "licencias de software",
    "equipo de computo",
    "equipo de cómputo",
    "impresion",
    "impresión",
    "cableado estructurado",
    "redes",
    "digitalizacion",
    "digitalización",

    // Insumos y servicios generales
    "limpieza",
    "servicios de limpieza",
    "seguridad",
    "vigilancia",
    "papeleria",
    "papelería",
    "material de oficina",
    "archivo",
    "gestion documental",
    "gestión documental",
  ],

  excludeTerms: [
    "hospital",
    "clinica",
    "clínica",
    "unidad medica",
    "medicamento",
    "equipo medico",
    "quirofano",
  ],

  geoTerms: ["ciudad de mexico", "cdmx", "distrito federal"],

  entityTerms: [
    "issste",
    "instituto de seguridad y servicios sociales de los trabajadores del estado",
  ],

  rules: [
    {
      ruleType: "entity",
      fieldName: "dependency_name",
      operator: "contains",
      value: "issste",
      weight: 0.5,
      isRequired: true,
    },
    {
      ruleType: "keyword",
      fieldName: "buying_unit",
      operator: "any_of",
      value: [
        "oficinas centrales",
        "administracion central",
        "corporativo",
        "direccion general",
      ],
      weight: 0.5,
      isRequired: false,
    },
    {
      ruleType: "geo",
      fieldName: "canonical_text",
      operator: "any_of",
      value: ["ciudad de mexico", "cdmx", "distrito federal"],
      weight: 0.3,
      isRequired: false,
    },
  ],
};
