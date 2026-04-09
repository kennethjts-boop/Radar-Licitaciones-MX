/**
 * RUN COLLECTOR (Test Manual)
 * Ignora el cron y dispara la lógica de recolección de ComprasMX una vez en modo local para debug y validación.
 */
import { config } from "dotenv";
import { resolve } from "path";

// Asegurar carga de enviroment primero
config({ path: resolve(__dirname, "../../../.env") });

import { createModuleLogger } from "../core/logger";
import { bootstrap } from "../bootstrap";
import { runCollectJob, setComprasMxSourceId } from "../jobs/collect.job";

const log = createModuleLogger("script:run-collector");

async function main() {
  log.info("--- RUN COLLECTOR MANUAL ---");

  // Ocupamos setear que use logs bonitos para la terminal
  process.env.NODE_ENV = "development";
  process.env.PLAYWRIGHT_HEADLESS = "false"; // Que veamos el browser para debugear

  log.info("🛠 Haciendo bootstrap...");
  const bootResult = await bootstrap();

  if (bootResult.sourceId) {
    setComprasMxSourceId(bootResult.sourceId);
  } else {
    log.fatal("No se resolvió comprasmx source ID.");
    process.exit(1);
  }

  log.info("🚀 Corriendo collectJob...");
  await runCollectJob();

  log.info("✅ Terminado exitosamente");
  process.exit(0);
}

main().catch((err) => {
  log.fatal({ err }, "Crash en run-collector script");
  process.exit(1);
});
