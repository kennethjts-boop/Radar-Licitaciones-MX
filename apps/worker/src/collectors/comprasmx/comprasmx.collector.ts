/**
 * COMPRASMX COLLECTOR — Implementación orquestadora (Fase 2)
 *
 * Utiliza Playwright (BrowserManager y Navigator) para navegar
 * y extraer metadata real, para luego normalizarla y devolverla al Job.
 */
import { createModuleLogger } from '../../core/logger';
import { nowISO } from '../../core/time';
import type { NormalizedProcurement } from '../../types/procurement';
import { BrowserManager } from './browser.manager';
import { ComprasMxNavigator } from './comprasmx.navigator';
import { normalize } from '../../normalizers/procurement.normalizer';
import { getConfig } from '../../config/env';
import { getSupabaseClient } from '../../storage/client';
import { createHash } from 'crypto';

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
  itemsSeen: number;
  stopReason: string | null;
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
  const config = getConfig();
  const baseUrl = config.COMPRASMX_SEED_URL || COMPRASMX_BASE_URL;
  const maxPages = options.maxPages ?? config.COMPRASMX_MAX_LIST_PAGES;
  const MAX_STREAK = config.COMPRASMX_STOP_AFTER_KNOWN_STREAK;

  log.info({ baseUrl, maxPages }, '🏁 Iniciando colector de Compras MX (NIVEL 1)...');

  const items: NormalizedProcurement[] = [];
  const errors: string[] = [];
  let pagesCollected = 0;
  let itemsSeen = 0;
  let stopReason: string | null = null;

  try {
    const db = getSupabaseClient();
    
    // Obtener el ID del source de una forma rápida
    const { data: sourceData } = await db.from('sources').select('id').eq('key', 'comprasmx').single();
    const sourceId = sourceData?.id;

    await BrowserManager.withContext(async (page, context) => {
      const navigator = new ComprasMxNavigator();
      
      // 1. Shallow Search: Scan Superficial de filas completas
      const listingRows = await navigator.scanListing(page, baseUrl, maxPages);
      pagesCollected = maxPages; 

      if (listingRows.length === 0) {
        stopReason = 'No listings extracted';
        log.warn('No se extrajeron expedientes del listado.');
        return;
      }

      // 2. Análisis Secuencial con Early Exit (Streak Condición)
      let knownStreak = 0;
      let count = 0;

      for (const row of listingRows) {
        count++;
        itemsSeen++;
        
        const lightweightFingerprint = createHash('sha256').update(row.rowText).digest('hex');

        // Check against DB
        let needsDetail = true;
        if (sourceId) {
           const { data: existing } = await db.from('procurements')
              .select('id, lightweight_fingerprint')
              .eq('source_id', sourceId)
              .eq('external_id', row.externalId)
              .single();

           if (existing) {
             if (existing.lightweight_fingerprint === lightweightFingerprint) {
                needsDetail = false;
                knownStreak++;
                // Update last_seen_at implicitly requested by design, can be offloaded to scheduler
             } else {
                needsDetail = true;
                knownStreak = 0; // Se rompe la racha si hay algo distinto
             }
           } else {
             needsDetail = true;
             knownStreak = 0;
           }
        }

        if (knownStreak >= MAX_STREAK) {
           stopReason = `Detenido tempranamente: Encontrados ${MAX_STREAK} expedientes idénticos consecutivos.`;
           log.info({ knownStreak }, stopReason);
           break;
        }

        if (!needsDetail) {
           log.debug({ externalId: row.externalId }, '⏩ Skipping (Mismo Fingerprint superficial)');
           continue;
        }

        log.info({ progress: `${count}/${listingRows.length}`, externalId: row.externalId }, '📥 Expediente Novedosos (NIVEL 2)');
        
        try {
          const rawInput = await navigator.extractDetail(context, row.sourceUrl);
          if (rawInput) {
            const normalized = normalize(rawInput);
            normalized.lightweightFingerprint = lightweightFingerprint;
            items.push(normalized);
          } else {
            errors.push(`No se pudo extraer detalle de: ${row.sourceUrl}`);
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          errors.push(`Error en URL ${row.sourceUrl}: ${errMsg}`);
        }
      }
    });

    if (!stopReason) stopReason = 'Procesamiento completo de max list pages';
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error({ err }, '💥 Falla crítica en infraestructura de BrowserManager');
    errors.push(`BrowserManager Crítico: ${errMsg}`);
    stopReason = 'Error crítico';
  }

  const finishedAt = nowISO();

  log.info(
    { itemsCount: items.length, errorsCount: errors.length },
    '✅ Colección Incremental (Nivel 1 -> 2) finalizada'
  );

  return {
    items,
    pagesCollected,
    itemsSeen,
    stopReason,
    errors,
    startedAt,
    finishedAt,
  };
}

/**
 * MODO 2: REVISIÓN DIARIA (Recheck de Activos)
 * Navega directo al detalle de las URLs dadas sin consultar listas.
 */
export async function recheckComprasMx(
  urls: string[]
): Promise<ComprasMxCollectResult> {
  const startedAt = nowISO();
  log.info({ count: urls.length }, '🏁 Iniciando colector de Compras MX (MODO 2 Re-Check directo)...');

  const items: NormalizedProcurement[] = [];
  const errors: string[] = [];

  try {
    await BrowserManager.withContext(async (page, context) => {
      const navigator = new ComprasMxNavigator();
      let count = 0;

      for (const url of urls) {
        count++;
        log.info({ progress: `${count}/${urls.length}` }, '🔄 Re-evaluando URL activa...');
        
        try {
          const rawInput = await navigator.extractDetail(context, url);
          if (rawInput) {
            const normalized = normalize(rawInput);
            items.push(normalized);
          } else {
            errors.push(`No se pudo re-extraer detalle de: ${url}`);
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          errors.push(`Error en ReCheck URL ${url}: ${errMsg}`);
        }
      }
    });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error({ err }, '💥 Falla crítica en BrowserManager durante ReCheck');
    errors.push(`BrowserManager Crítico: ${errMsg}`);
  }

  return {
    items,
    pagesCollected: 0,
    itemsSeen: urls.length,
    stopReason: urls.length === 0 ? 'No hay URLs a revisar' : 'Lista predefinida completada',
    errors,
    startedAt,
    finishedAt: nowISO(),
  };
}
