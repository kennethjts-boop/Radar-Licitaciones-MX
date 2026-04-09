/**
 * DOF COLLECTOR STUB — Diario Oficial de la Federación
 *
 * TODO (Fase 3):
 * - Base URL: https://dof.gob.mx/
 * - Requiere parsing de RSS o scraping de publicaciones del día
 * - Sección relevante: "Convocatorias" y "Avisos"
 * - Puede requerir descarga de PDFs para extraer expedientes
 */
import { createModuleLogger } from '../../core/logger';
import { nowISO } from '../../core/time';
import type { NormalizedProcurement } from '../../types/procurement';

const log = createModuleLogger('collector-dof');

export const DOF_SOURCE_KEY = 'dof';
export const DOF_BASE_URL = 'https://dof.gob.mx/';

export interface DofCollectResult {
  items: NormalizedProcurement[];
  errors: string[];
  startedAt: string;
  finishedAt: string;
}

export async function collectDof(): Promise<DofCollectResult> {
  const startedAt = nowISO();
  log.warn('STUB: collector DOF no implementado — implementar en Fase 3');
  return { items: [], errors: ['Collector DOF — Fase 3 stub'], startedAt, finishedAt: nowISO() };
}
