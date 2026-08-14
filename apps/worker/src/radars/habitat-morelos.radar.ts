/**
 * Slot histórico reutilizado para el foco geográfico Morelos general.
 * La evaluación efectiva exige señales estructuradas y no usa texto libre.
 */
import type { RadarConfig } from "../types/procurement";

export const habitatMorelosRadar: RadarConfig = {
  key: "habitat_morelos",
  name: "Morelos — cualquier dependencia",
  description:
    "Cualquier dependencia con entidad federativa o unidad compradora estructurada de Morelos.",
  isActive: true,
  priority: 1,
  scheduleMinutes: 30,
  minScore: 1,
  includeTerms: [],
  excludeTerms: [],
  geoTerms: ["Morelos"],
  entityTerms: [],
  rules: [],
};
