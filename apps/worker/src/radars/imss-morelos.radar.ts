/**
 * RADAR: imss_morelos
 * Prioridad institucional total para cualquier licitacion del IMSS en Morelos.
 */
import type { RadarConfig } from "../types/procurement";

export const imssMorelosRadar: RadarConfig = {
  key: "imss_morelos",
  name: "IMSS — Morelos",
  description:
    "Detecta IMSS por dependencia estructurada y Morelos por ubicación/unidad estructurada.",
  isActive: true,
  priority: 1,
  scheduleMinutes: 30,
  minScore: 1,

  includeTerms: [],
  excludeTerms: [],
  geoTerms: ["Morelos"],
  entityTerms: ["IMSS"],

  rules: [],
};
