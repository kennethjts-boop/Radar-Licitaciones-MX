import "dotenv/config";
import { getSupabaseClient } from "../storage/client";
import { collectComprasMx } from "../collectors/comprasmx/comprasmx.collector";
import { buildListingFingerprint } from "../collectors/comprasmx/comprasmx.navigator";

async function run() {
  console.log("--- TEST FASE 2A CONTROLLED (Logic Verification) ---");
  const db = getSupabaseClient();

  try {
    // 1. Obtener el source_id de ComprasMX
    const { data: source } = await db.from('sources').select('id').eq('key', 'comprasmx').single();
    if (!source) throw new Error("Source 'comprasmx' no encontrado en DB");
    const sourceId = source.id;

    console.log("Limpiando datos de prueba previos...");
    await db.from('procurements').delete().eq('external_id', 'TEST-F2A-SKIP');
    await db.from('procurements').delete().eq('external_id', 'TEST-F2A-MUTATE');

    // 2. Sembrar un registro para SKIP
    // Nota: El fingerprint real se basa en lo que el portal devuelve. 
    // Para probar la lógica, crearemos un registro que coincida con lo que esperamos ver.
    // Usaremos un ID real que sepamos que está en la primera página para forzar el skip.
    
    console.log("Preparando escenario: SKIP por fingerprint idéntico");
    // Extraeremos el primer ID del portal primero
    const { ComprasMxNavigator } = await import("../collectors/comprasmx/comprasmx.navigator");
    const { BrowserManager } = await import("../collectors/comprasmx/browser.manager");
    
    let firstRow: any = null;
    await BrowserManager.withContext(async (page) => {
        const nav = new ComprasMxNavigator();
        const { rows } = await nav.scanListing(page, process.env.COMPRASMX_SEED_URL!, 1);
        if (rows.length > 0) firstRow = rows[0];
    });

    if (firstRow) {
        const fp = buildListingFingerprint(firstRow);
        console.log(`Sembrando item ${firstRow.externalId} con FP ${fp.substring(0,10)}...`);
        
        await db.from('procurements').upsert({
            source_id: sourceId,
            external_id: firstRow.externalId,
            title: firstRow.title || 'Controlado',
            status: firstRow.status || 'VIGENTE',
            lightweight_fingerprint: fp,
            source_url: 'http://localhost/test'
        });

        console.log("\n--- EJECUTANDO COLECTOR (MODO 1) ---");
        // Forzamos un streak pequeño para que termine rápido si encuentra conocidos
        process.env.COMPRASMX_STOP_AFTER_KNOWN_STREAK = "1";
        const result = await collectComprasMx({ maxPages: 1 });

        console.log("\n--- VERIFICACIÓN DE LÓGICA ---");
        if (result.skippedByFingerprint > 0) {
            console.log("✅ ÉXITO: Se detectó y saltó el registro conocido (SKIP).");
        } else {
            console.log("❌ FALLO: No se detectó el skip por fingerprint.");
        }

        if (result.stopReason?.includes("stop condition")) {
            console.log("✅ ÉXITO: La condición de parada (Streak) funcionó correctamente.");
        } else {
            console.log("❌ FALLO: La condición de parada no se activó.");
        }

        console.log("\nTelemetría final:");
        console.log(`  Skipped: ${result.skippedByFingerprint}`);
        console.log(`  Stop Reason: ${result.stopReason}`);

    } else {
        console.log("⚠️ No se pudo obtener filas del portal para la prueba controlada.");
    }

  } catch (err) {
    console.error("❌ Error en prueba controlada:", err);
  } finally {
      process.exit(0);
  }
}

run();
