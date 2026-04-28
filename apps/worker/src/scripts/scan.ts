/**
 * SCAN — Ejecución manual del colector ComprasMX.
 *
 * Uso: npm run scan
 */
import "dotenv/config";
import { bootstrap } from "../bootstrap";
import { setComprasMxSourceId } from "../jobs/collect.job";
import { runCollectJob } from "../jobs/collect.job";
import { getLogger } from "../core/logger";

async function main() {
  const log = getLogger();

  log.info("🚀 Iniciando ESCANEO MANUAL desde script...");

  // 1. Bootstrap
  const bootResult = await bootstrap();
  if (bootResult.sourceId) {
    setComprasMxSourceId(bootResult.sourceId);
  }

  // 2. Ejecutar colector ComprasMX
  await runCollectJob();

  log.info("✅ ESCANEO MANUAL COMPLETADO.");
  process.exit(0);
}

main().catch(err => {
  console.error("💥 Error fatal en scan:", err);
  process.exit(1);
});
