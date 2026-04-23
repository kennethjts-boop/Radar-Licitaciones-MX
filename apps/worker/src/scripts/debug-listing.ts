
import { BrowserManager } from "../collectors/comprasmx/browser.manager";
import { ComprasMxNavigator } from "../collectors/comprasmx/comprasmx.navigator";
import { getConfig } from "../config/env";
import { createModuleLogger } from "../core/logger";

const log = createModuleLogger("debug-listing");

async function debug() {
  const config = getConfig();
  const baseUrl = config.COMPRASMX_SEED_URL;

  await BrowserManager.withContext(async (page, _context) => {
    const navigator = new ComprasMxNavigator();
    log.info("--- INICIANDO DEPURACIÓN DE LISTADO ---");
    
    // Escanear 2 páginas para ver qué hay
    const { rows, apiRegistros } = await navigator.scanListing(page, baseUrl, 2);
    
    console.log(`\n--- MUESTRA DE DATOS (Página 1 y 2) ---`);
    console.log(`Total filas en DOM: ${rows.length}`);
    console.log(`Total registros en API: ${apiRegistros.size}`);
    console.log(`---------------------------------------\n`);

    // Mostrar los primeros 30 items
    rows.slice(0, 30).forEach((row, i) => {
      const api = apiRegistros.get(row.externalId);
      console.log(`${i+1}. [${row.externalId}] ${row.title?.slice(0, 50)}...`);
      console.log(`   DEP (DOM): ${row.dependency}`);
      console.log(`   DEP (API): ${api?.siglas || 'N/A'}`);
      console.log(`   STATUS: ${row.status} | DATE: ${row.visibleDate}`);
      console.log(`---`);
    });
  });
}

debug().catch(console.error);
