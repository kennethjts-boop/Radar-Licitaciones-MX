/**
 * RADAR: morelos_general
 * Captura CUALQUIER licitación donde el texto del expediente mencione
 * Morelos o municipios del estado. Diseñado como net amplio geográfico
 * sin filtro por institución ni tipo de procedimiento.
 *
 * Nota técnica: canonical_text no incluye el campo state (que almacena
 * "NACIONAL/INTERNACIONAL"), por lo que se usa keyword matching sobre
 * el texto de título, descripción y dependencia.
 */
import type { RadarConfig } from "../types/procurement";

export const morelosGeneralRadar: RadarConfig = {
  key: "morelos_general",
  name: "🏔️ MORELOS — Radar General",
  description:
    "Captura cualquier licitación relacionada con el estado de Morelos: " +
    "detecta por nombre del estado y municipios en título, descripción o dependencia.",
  isActive: true,
  priority: 1,
  scheduleMinutes: 30,
  minScore: 0.4,

  includeTerms: [
    // El estado
    "morelos",
    "estado de morelos",
    // Municipios con mayor actividad licitatoria
    "cuernavaca",
    "cuautla",
    "jiutepec",
    "temixco",
    "jojutla",
    "zacatepec",
    "yautepec",
    "puente de ixtla",
  ],

  excludeTerms: [],

  geoTerms: [
    "morelos",
    "cuernavaca",
    "cuautla",
    "jiutepec",
    "temixco",
    "jojutla",
    "zacatepec",
    "yautepec",
    "puente de ixtla",
  ],

  entityTerms: [],

  rules: [],
};
