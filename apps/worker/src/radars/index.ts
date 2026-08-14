/**
 * RADARS — Registro central de todos los radares activos.
 * Para agregar un radar: importarlo y añadirlo al array RADARS.
 */
import type { RadarConfig } from "../types/procurement";

import { capufeEmergenciaRadar } from "./capufe-emergencia.radar";
import { capufeDirectAwardsRadar } from "./capufe-direct-awards.radar";
import { capufeMantenimientoEquiposRadar } from "./capufe-mantenimiento-equipos.radar";
import { capufePeajeRadar } from "./capufe-peaje.radar";
import { capufeOportunidadesRadar } from "./capufe-oportunidades.radar";
import { isssteoOficinasCentralesRadar } from "./issste-oficinas-centrales.radar";
import { conaviFederalRadar } from "./conavi-federal.radar";
import { imssMorelosRadar } from "./imss-morelos.radar";
import { imssBienestarMorelosRadar } from "./imss-bienestar-morelos.radar";
import { habitatMorelosRadar } from "./habitat-morelos.radar";
import { BUSINESS_LINE_RADARS } from "./business-lines.radar";
import { OPERATIONAL_FOCUS_KEYS } from "./operational-focus.matcher";

const ACTIVE_FOCUS_KEYS = new Set<string>(Object.values(OPERATIONAL_FOCUS_KEYS));

/**
 * Lista canónica de todos los radares.
 * El matcher itera sobre esta lista en cada ciclo.
 */
const ALL_RADAR_DEFINITIONS: RadarConfig[] = [
  capufeDirectAwardsRadar,
  capufeEmergenciaRadar,
  capufeMantenimientoEquiposRadar,
  capufePeajeRadar,
  capufeOportunidadesRadar,
  isssteoOficinasCentralesRadar,
  conaviFederalRadar,
  imssMorelosRadar,
  imssBienestarMorelosRadar,
  habitatMorelosRadar,
  ...BUSINESS_LINE_RADARS,
];

/**
 * Estado operativo canónico. Las definiciones históricas se conservan, pero
 * solamente los cuatro focos aprobados pueden participar en el matcher.
 */
export const RADARS: RadarConfig[] = ALL_RADAR_DEFINITIONS.map((radar) => ({
  ...radar,
  isActive: ACTIVE_FOCUS_KEYS.has(radar.key),
}));

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

/**
 * Consulta la tabla `radars` en Supabase para obtener conteos reales en tiempo de ejecución.
 */
export async function getDbRadarCounts(): Promise<{ active: number; dormant: number; total: number }> {
  try {
    const { getSupabaseClient } = await import("../storage/client");
    const db = getSupabaseClient();
    const { data, error } = await db.from("radars").select("key, is_active");
    if (!error && Array.isArray(data) && data.length > 0) {
      const active = data.filter((r: { is_active?: boolean }) => Boolean(r.is_active)).length;
      const dormant = data.filter((r: { is_active?: boolean }) => !r.is_active).length;
      return { active, dormant, total: data.length };
    }
  } catch {
    // fallback
  }
  const activeFallback = getActiveRadars().length;
  return {
    active: activeFallback,
    dormant: RADARS.length - activeFallback,
    total: RADARS.length,
  };
}
