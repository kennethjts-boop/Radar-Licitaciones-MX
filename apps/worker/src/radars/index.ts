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
import { EDOMEX_FOCUS_KEYS } from "./edomex-focus.matcher";

/** Once focos de octubre + cuatro focos del Estado de México. */
export const ACTIVE_RADAR_KEYS: readonly string[] = [
  ...Object.values(OPERATIONAL_FOCUS_KEYS),
  ...Object.values(EDOMEX_FOCUS_KEYS),
];
const ACTIVE_FOCUS_KEYS = new Set<string>(ACTIVE_RADAR_KEYS);

const OCTOBER_FOCUSES: Array<[string, string, string]> = [
  [OPERATIONAL_FOCUS_KEYS.capufeSecurity, "CAPUFE — Seguridad y vigilancia", "Guardias y vigilancia presencial"],
  [OPERATIONAL_FOCUS_KEYS.capufeEmergencyVehicles, "CAPUFE — Vehículos de emergencia y auxilio vial", "Vehículos de rescate y auxilio"],
  [OPERATIONAL_FOCUS_KEYS.capufeAdministrativeVehicles, "CAPUFE — Vehículos administrativos", "Flota administrativa"],
  [OPERATIONAL_FOCUS_KEYS.capufeGeneralCleaning, "CAPUFE — Limpieza integral general", "Servicios generales de limpieza"],
  [OPERATIONAL_FOCUS_KEYS.capufeFurniture, "CAPUFE — Mobiliario y equipamiento", "Adquisición de mobiliario"],
  [OPERATIONAL_FOCUS_KEYS.capufeSpecialNationalCleaning, "CAPUFE — Limpieza especial nacional", "Limpieza especial con cobertura nacional"],
  [OPERATIONAL_FOCUS_KEYS.imssCleaning, "IMSS — Limpieza nacional", "Servicios de limpieza"],
  [OPERATIONAL_FOCUS_KEYS.imssSecurity, "IMSS — Seguridad y vigilancia nacional", "Guardias y vigilancia presencial"],
  [OPERATIONAL_FOCUS_KEYS.imssClinicalLaboratory, "IMSS — Estudios de laboratorio clínico", "Servicio médico integral de laboratorio"],
  [OPERATIONAL_FOCUS_KEYS.imssBloodBank, "IMSS — Banco de sangre", "Servicio médico integral de banco de sangre"],
];

const EDOMEX_FOCUSES: Array<[string, string, string]> = [
  [EDOMEX_FOCUS_KEYS.issemym, "EDOMEX — ISSEMyM", "Cualquier licitación nueva del ISSEMyM, de cualquier giro y monto"],
  [EDOMEX_FOCUS_KEYS.carreteras, "EDOMEX — Carreteras > $100 MDP", "Rehabilitación, conservación, pavimentación y bacheo carretero superiores a 100 MDP"],
  [EDOMEX_FOCUS_KEYS.sitramytem, "EDOMEX — SITRAMyTEM vial y mantenimiento", "Trabajos viales y mantenimiento acotado; sin proyectos integrales ni concesiones"],
  [EDOMEX_FOCUS_KEYS.oportunidades, "EDOMEX — Dependencias y municipios alto monto", "Obras, tecnología, equipamiento, vehículos, limpieza, seguridad y suministros desde 20 MDP"],
];

const OCTOBER_RADARS: RadarConfig[] = [...OCTOBER_FOCUSES, ...EDOMEX_FOCUSES].map(([key, name, description]) => ({
  key, name, description, isActive: true, priority: 1, scheduleMinutes: 30,
  minScore: 1, includeTerms: [], excludeTerms: [], geoTerms: [], entityTerms: [], rules: [],
}));

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
  ...OCTOBER_RADARS,
];

/**
 * Estado operativo canónico. Las definiciones históricas se conservan, pero
 * solamente los once focos aprobados y los cuatro del Estado de México
 * pueden participar en el matcher.
 */
export const RADARS: RadarConfig[] = ALL_RADAR_DEFINITIONS.map((radar) => ({
  ...radar,
  isActive: ACTIVE_FOCUS_KEYS.has(radar.key),
  priority: radar.key === OPERATIONAL_FOCUS_KEYS.imssOaxtepec ? 2 : radar.priority,
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
