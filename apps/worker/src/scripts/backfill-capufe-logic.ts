
import { collectComprasMx } from "../collectors/comprasmx/comprasmx.collector";
import { upsertProcurement } from "../storage/procurement.repo";
import { getActiveRadars } from "../radars/index";
import { evaluateAllRadars } from "../matchers/matcher";
import { enrichMatch } from "../enrichers/match.enricher";
import { sendMatchAlert, sendTelegramMessage } from "../alerts/telegram.alerts";
import { getSupabaseClient } from "../storage/client";
import { createModuleLogger } from "../core/logger";

const log = createModuleLogger("backfill-capufe");

export async function runBackfill(): Promise<void> {
  log.info("🚀 Iniciando BACKFILL de CAPUFE (últimas 24h)...");
  
  await sendTelegramMessage("⏳ <b>Iniciando recuperación de datos (últimas 24h)...</b>\nBuscando expedientes de CAPUFE que pudieron publicarse mientras el sistema estaba inactivo.", "HTML");

  try {
    // 1. Escaneo profundo de 30 páginas para asegurar cubrir las últimas 24-48h
    // ComprasMX suele publicar entre 5-10 páginas por día. 30 páginas es muy seguro.
    const result = await collectComprasMx({ maxPages: 30, headless: true });
    log.info({ items: result.items.length }, "Items recolectados en backfill");

    const db = getSupabaseClient();
    const { data: source } = await db.from("sources").select("id").eq("key", "comprasmx").single();
    const sourceId = source?.id;

    if (!sourceId) throw new Error("No source ID for comprasmx");

    const radars = getActiveRadars();
    let matchesFound = 0;

    for (const item of result.items) {
      const isCapufe = (item.dependencyName || "").toLowerCase().includes("capufe") || 
                       item.canonicalText.toLowerCase().includes("capufe");
      
      if (!isCapufe) continue;

      log.info({ externalId: item.externalId }, "Procesando expediente CAPUFE encontrado en backfill");
      
      const upsert = await upsertProcurement(item, sourceId);
      
      // Evaluar radares para este item de CAPUFE
      const matches = evaluateAllRadars(item, radars, upsert.isNew);
      
      for (const match of matches) {
        // Nos enfocamos en los radares de CAPUFE
        if (match.radarKey.toLowerCase().includes("capufe")) {
          matchesFound++;
          const enriched = await enrichMatch(item, { ...match, procurementId: upsert.procurementId });
          await sendMatchAlert(enriched);
        }
      }
    }

    await sendTelegramMessage(`✅ <b>Recuperación completada</b>\nSe analizaron 30 páginas de ComprasMX y se procesaron ${matchesFound} expedientes de CAPUFE detectados.`, "HTML");
  } catch (err) {
    log.error({ err }, "Error en runBackfill");
    await sendTelegramMessage("❌ <b>Error en Recuperación</b>\nOcurrió un fallo técnico al intentar recuperar los datos.", "HTML");
    throw err;
  }
}
