/**
 * Cruce directo de BIRMEX con ComprasMX (API firmada del colector).
 *
 * El listado general sólo trae procedimientos vigentes y el colector salta las
 * filas conocidas, así que un cambio de fecha o estatus de BIRMEX puede quedar
 * sin actualizar. Esta búsqueda dirigida por la unidad compradora 012NEF001
 * trae todos sus expedientes y los actualiza por el camino normal
 * (`upsertProcurement`), de modo que la conciliación evalúe datos frescos.
 */
import { getSupabaseClient } from "../../storage/client";
import { createModuleLogger } from "../../core/logger";
import { upsertProcurement } from "../../storage/procurement.repo";
import { normalize } from "../../normalizers/procurement.normalizer";
import { apiRegistroToRawInput, searchComprasMxProcedimientos } from "../../collectors/comprasmx/comprasmx.navigator";

const log = createModuleLogger("birmex-refresh");

export interface BirmexRefreshResult {
  coverage: "complete" | "partial";
  total: number | null;
  read: number;
  created: number;
  /** Sólo escrituras efectivas (cambio de fecha, estatus, monto o texto). */
  updated: number;
  unchanged: number;
  error?: string;
}

export async function refreshBirmexFromSource(
  deps: { search?: typeof searchComprasMxProcedimientos } = {},
): Promise<BirmexRefreshResult> {
  const search = deps.search ?? searchComprasMxProcedimientos;
  const result: BirmexRefreshResult = { coverage: "partial", total: null, read: 0, created: 0, updated: 0, unchanged: 0 };
  try {
    const found = await search({ numero_procedimiento: "012NEF001" }, 10);
    result.total = found.total;
    result.read = found.registros.length;
    const { data: source, error } = await getSupabaseClient().from("sources").select("id").eq("key", "comprasmx").maybeSingle();
    if (error || !source) throw new Error(`Fuente comprasmx: ${error?.message ?? "ausente"}`);
    for (const registro of found.registros) {
      const upsert = await upsertProcurement(normalize(apiRegistroToRawInput(registro)), source.id as string);
      if (upsert.isNew) result.created++;
      else if (upsert.isUpdated) result.updated++;
      else result.unchanged++;
    }
    // Cobertura completa sólo si se leyó todo lo que el portal reporta.
    result.coverage = found.total !== null && found.registros.length >= found.total ? "complete" : "partial";
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    log.warn({ err }, "Cruce directo de BIRMEX con ComprasMX parcial");
  }
  return result;
}
