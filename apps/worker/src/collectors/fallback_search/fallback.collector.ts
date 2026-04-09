/**
 * FALLBACK SEARCH COLLECTOR STUB
 *
 * TODO (Fase 3):
 * - Fallback para dependencias no cubiertas por otros collectors
 * - Potencialmente Google Custom Search / DuckDuckGo
 * - Solo activar si Compras MX no retorna resultados para un radar específico
 */
import { createModuleLogger } from "../../core/logger";
import type { NormalizedProcurement } from "../../types/procurement";

const log = createModuleLogger("collector-fallback");

export async function collectFallbackSearch(_query: string): Promise<{
  items: NormalizedProcurement[];
  errors: string[];
}> {
  log.warn("STUB: collector fallback — Fase 3");
  return { items: [], errors: ["Fallback search — Fase 3 stub"] };
}
