/**
 * COMPRASMX COLLECTOR — Estructura y contrato para Fase 1.
 *
 * FASE 0: El collector retorna datos vacíos con la interfaz correcta.
 * FASE 1: Implementar Playwright scraping real aquí.
 *
 * URL base: https://www.comprasmx.gob.mx/
 * Requiere: Playwright, manejo de paginación, detalle de expediente.
 */
import { createModuleLogger } from '../../core/logger';
import { nowISO } from '../../core/time';
import type { NormalizedProcurement } from '../../types/procurement';

const log = createModuleLogger('collector-comprasmx');

export const COMPRASMX_SOURCE_KEY = 'comprasmx';
export const COMPRASMX_BASE_URL = 'https://www.comprasmx.gob.mx/';

export interface ComprasMxCollectorOptions {
  maxPages?: number;
  headless?: boolean;
  timeoutMs?: number;
}

/**
 * Resultado de una corrida del collector.
 */
export interface ComprasMxCollectResult {
  items: NormalizedProcurement[];
  pagesCollected: number;
  errors: string[];
  startedAt: string;
  finishedAt: string;
}

/**
 * STUB — Collector de Compras MX.
 *
 * TODO (Fase 1):
 * 1. Inicializar Playwright browser
 * 2. Navegar a la URL de búsqueda con filtros de fecha
 * 3. Iterar páginas del listado
 * 4. Para cada resultado: navegar a detalle, extraer campos
 * 5. Extraer número de licitación del título o adjuntos si existe
 * 6. Extraer adjuntos y sus URLs
 * 7. Normalizar y retornar
 *
 * NOTAS TÉCNICAS (Fase 1):
 * - La paginación de Compras MX es por parámetro de query o scroll dinámico
 * - El número de licitación puede estar en el título, en un campo separado o en PDFs
 * - Los adjuntos pueden requerir click en subpagina de documentos
 * - Respetar rate limiting: esperar 2-5s entre páginas
 * - Implementar retry en case de timeout o error de red
 */
export async function collectComprasMx(
  options: ComprasMxCollectorOptions = {}
): Promise<ComprasMxCollectResult> {
  const startedAt = nowISO();

  log.warn(
    'STUB: collector Compras MX no implementado — implementar en Fase 1'
  );

  // En Fase 1, aquí irá el código Playwright real.
  // Por ahora retornamos resultado vacío para no romper el pipeline.

  return {
    items: [],
    pagesCollected: 0,
    errors: ['Collector no implementado — Fase 0 stub'],
    startedAt,
    finishedAt: nowISO(),
  };
}
