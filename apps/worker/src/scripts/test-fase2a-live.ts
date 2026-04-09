import "dotenv/config";
import { BrowserManager } from "../collectors/comprasmx/browser.manager";
import { ComprasMxNavigator } from "../collectors/comprasmx/comprasmx.navigator";
import { collectComprasMx } from "../collectors/comprasmx/comprasmx.collector";

async function run() {
  console.log("--- TEST FASE 2A LIVE ---");
  try {
    // Ejecutar una corrida real con 1 página
    const result = await collectComprasMx({ maxPages: 1 });
    
    console.log("\n--- RESULTADOS TELEMETRÍA ---");
    console.log(JSON.stringify(result, (key, value) => {
        if (key === 'items') return `[${value.length} items]`;
        return value;
    }, 2));

    if (result.items.length > 0) {
      console.log("\n--- MUESTRA DEL PRIMER ITEM ---");
      const first = result.items[0];
      console.log(`ID: ${first.externalId}`);
      console.log(`Título: ${first.title}`);
      console.log(`Estatus: ${first.status}`);
      console.log(`Dependencia: ${first.dependencyName}`);
      console.log(`Adjuntos: ${first.attachments.length}`);
      if (first.attachments.length > 0) {
          console.log(`Primer Adjunto: ${first.attachments[0].fileName}`);
      }
    } else {
        console.log("\n⚠️ No se extrajeron items. Revisa los logs de Pino arriba.");
    }

  } catch (err) {
    console.error("❌ Error en ejecución live:", err);
  } finally {
      process.exit(0);
  }
}

run();
