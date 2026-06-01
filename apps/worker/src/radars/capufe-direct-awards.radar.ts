/**
 * RADAR: capufe_direct_awards
 * Detecta adjudicaciones directas de CAPUFE en ComprasMX.
 */
import type { RadarConfig } from "../types/procurement";

export const capufeDirectAwardsRadar: RadarConfig = {
  key: "capufe_direct_awards",
  name: "CAPUFE — Adjudicación Directa",
  description:
    "Detecta procedimientos de adjudicación directa relacionados claramente con CAPUFE.",
  isActive: true,
  priority: 1,
  scheduleMinutes: 30,
  minScore: 0.95,

  includeTerms: [
    "capufe",
    "caminos y puentes federales",
    "adjudicacion directa",
    "adjudicación directa",
  ],

  excludeTerms: [],

  geoTerms: [],

  entityTerms: [
    "capufe",
    "caminos y puentes federales de ingresos y servicios conexos",
  ],

  rules: [],
};
