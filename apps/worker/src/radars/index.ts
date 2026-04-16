/**
 * RADARS — Registro central de todos los radares activos.
 * Para agregar un radar: importarlo y añadirlo al array RADARS.
 */
import type { RadarConfig } from "../types/procurement";

import { capufeEmergenciaRadar } from "./capufe-emergencia.radar";
import { capufeMantenimientoEquiposRadar } from "./capufe-mantenimiento-equipos.radar";
import { capufePeajeRadar } from "./capufe-peaje.radar";
import { capufeOportunidadesRadar } from "./capufe-oportunidades.radar";
import { isssteoOficinasCentralesRadar } from "./issste-oficinas-centrales.radar";
import { conaviFederalRadar } from "./conavi-federal.radar";
import { imssMorelosRadar } from "./imss-morelos.radar";
import { imssBienestarMorelosRadar } from "./imss-bienestar-morelos.radar";
import { habitatMorelosRadar } from "./habitat-morelos.radar";
import { fondosSaludRadar } from "./fondos-salud.radar";
import { fondosDeporteRadar } from "./fondos-deporte.radar";
import { fondosCulturaRadar } from "./fondos-cultura.radar";

/**
 * Lista canónica de todos los radares.
 * El matcher itera sobre esta lista en cada ciclo.
 */
export const RADARS: RadarConfig[] = [
  capufeEmergenciaRadar,
  capufeMantenimientoEquiposRadar,
  capufePeajeRadar,
  capufeOportunidadesRadar,
  isssteoOficinasCentralesRadar,
  conaviFederalRadar,
  imssMorelosRadar,
  imssBienestarMorelosRadar,
  habitatMorelosRadar,
  // Fondos internacionales para donatarias autorizadas
  fondosSaludRadar,
  fondosDeporteRadar,
  fondosCulturaRadar,
];

/**
 * Retorna los radares activos ordenados por prioridad.
 */
export function getActiveRadars(): RadarConfig[] {
  return RADARS.filter((r) => r.isActive).sort(
    (a, b) => a.priority - b.priority,
  );
}

/**
 * Busca un radar por su key.
 */
export function getRadarByKey(key: string): RadarConfig | undefined {
  return RADARS.find((r) => r.key === key);
}
