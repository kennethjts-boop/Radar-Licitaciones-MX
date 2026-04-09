import "dotenv/config";
import process from "process";
import postgres from "postgres";
import { createModuleLogger } from "../core/logger";

const log = createModuleLogger("verify-fase2a");

async function main() {
  log.info("🔍 Iniciando verificación post-migración Fase 2A...");

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    log.fatal(
      "❌ SUPABASE_DB_URL no está configurado. Requerido para verificación directa de schema.",
    );
    process.exit(1);
  }

  log.info("Conectando a base de datos...");
  const sql = postgres(dbUrl, {
    ssl: { rejectUnauthorized: false },
    max: 1,
    idle_timeout: 5,
  });

  try {
    // 1. Verificar columnas en procurements
    log.info("Revisando columnas en tabla procurements...");
    const columnsResult = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'procurements' 
        AND column_name IN ('lightweight_fingerprint', 'last_detail_checked_at', 'last_attachments_checked_at');
    `;

    const foundColumns = columnsResult.map((row) => row.column_name);
    const expectedColumns = [
      "lightweight_fingerprint",
      "last_detail_checked_at",
      "last_attachments_checked_at",
    ];

    let allColumnsPass = true;
    for (const expected of expectedColumns) {
      if (foundColumns.includes(expected)) {
        log.info(`✅ Columna encontrada: ${expected}`);
      } else {
        log.error(`❌ Columna FALTANTE: ${expected}`);
        allColumnsPass = false;
      }
    }

    // 2. Verificar índice
    log.info("Revisando existencia de índice idx_proc_lightweight_fp...");
    const indexResult = await sql`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'procurements' AND indexname = 'idx_proc_lightweight_fp';
    `;

    let indexPass = false;
    if (indexResult.length > 0) {
      log.info("✅ Índice idx_proc_lightweight_fp existe.");
      indexPass = true;
    } else {
      log.error("❌ Índice idx_proc_lightweight_fp NO ENCONTRADO.");
    }

    if (allColumnsPass && indexPass) {
      log.info(
        "🎉 Verificación Fase 2A EXITOSA. Schema preparado para entorno incremental.",
      );
      process.exit(0);
    } else {
      log.error(
        "💥 Fallo en verificación de Fase 2A. Revisa la salida e intenta correr la migración.",
      );
      process.exit(1);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.fatal({ err: errorMsg }, "Error fatal durante verificación");
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
