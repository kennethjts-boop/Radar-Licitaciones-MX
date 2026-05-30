/**
 * RADAR: imss_morelos
 * Prioridad institucional total para cualquier licitacion del IMSS en Morelos.
 */
import type { RadarConfig } from "../types/procurement";
import {
  IMSS_BIENESTAR_EXCLUSION_TERMS,
  MORELOS_TERRITORY_TERMS,
} from "./imss-morelos-priority.matcher";

export const imssMorelosRadar: RadarConfig = {
  key: "imss_morelos",
  name: "IMSS Morelos — Prioridad total",
  description:
    "Detecta cualquier licitacion de ComprasMX donde aparezcan IMSS y Morelos, sin depender de keywords comerciales o rubros.",
  isActive: true,
  priority: 1,
  scheduleMinutes: 30,
  minScore: 1,

  includeTerms: [
    "imss",
    "i.m.s.s.",
    "instituto mexicano del seguro social",
    "seguro social",
    "ooad morelos",
    "organo de operacion administrativa desconcentrada estatal morelos",
    "organo de operacion administrativa desconcentrada del imss en morelos",
    "organo de operacion administrativa desconcentrada regional morelos",
    "delegacion morelos imss",
    "representacion morelos imss",
    "imss morelos",
    "hospital general de zona del imss",
    "unidad de medicina familiar del imss",
    "umf imss",
    "hgz imss",
    "hgr imss",
  ],

  excludeTerms: IMSS_BIENESTAR_EXCLUSION_TERMS,

  geoTerms: MORELOS_TERRITORY_TERMS,

  entityTerms: [
    "imss",
    "i.m.s.s.",
    "instituto mexicano del seguro social",
    "ooad morelos",
  ],

  rules: [],
};
