/**
 * Slot histórico reutilizado para el foco específico IMSS Oaxtepec.
 * La key se conserva para mantener exactamente las 12 filas de producción.
 */
import type { RadarConfig } from "../types/procurement";

export const imssBienestarMorelosRadar: RadarConfig = {
  key: "imss_bienestar_morelos",
  name: "IMSS — Oaxtepec, Morelos",
  description:
    "IMSS y unidad compradora estructurada 050GYR085 - CENTRO VACACIONAL IMSS OAXTEPEC.",
  isActive: true,
  priority: 1,
  scheduleMinutes: 30,
  minScore: 1,
  includeTerms: [],
  excludeTerms: [],
  geoTerms: [],
  entityTerms: ["IMSS"],
  rules: [],
};
