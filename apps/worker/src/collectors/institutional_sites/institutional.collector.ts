/**
 * INSTITUTIONAL SITES COLLECTOR STUB
 *
 * TODO (Fase 3):
 * - Sitios institucionales de dependencias sin portal ComprasMX completo
 * - Cada sitio requiere su propio parser
 * - Implementar como sub-collectors por sitio
 */
import { createModuleLogger } from '../../core/logger';
import { nowISO } from '../../core/time';
import type { NormalizedProcurement } from '../../types/procurement';

const log = createModuleLogger('collector-institutional');

export async function collectInstitutionalSites(): Promise<{
  items: NormalizedProcurement[];
  errors: string[];
}> {
  log.warn('STUB: collector sitios institucionales — Fase 3');
  return { items: [], errors: ['Sitios institucionales — Fase 3 stub'] };
}
