/**
 * RADAR: capufe_oportunidades
 * Slot histórico reutilizado para el foco operativo CAPUFE nacional.
 */
import type { RadarConfig } from "../types/procurement";

export const capufeOportunidadesRadar: RadarConfig = {
  key: "capufe_oportunidades",
  name: "CAPUFE — Nacional",
  description: "CAPUFE por dependencia/siglas estructuradas, sin restricción estatal.",
  isActive: true,
  priority: 1,
  scheduleMinutes: 30,
  minScore: 1,
  includeTerms: [],
  excludeTerms: [],
  geoTerms: [],
  entityTerms: ["CAPUFE"],
  rules: [],
};
