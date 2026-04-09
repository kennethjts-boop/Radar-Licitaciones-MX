/**
 * DB VERIFY — Script de verificación de tablas en Phase 1A.
 *
 * Reutiliza el schema-validator sin levantar el worker.
 * Usa la API REST de Supabase, por lo que requiere:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */
import { verifyDatabaseSchema } from "../storage/schema-validator";
import { getConfig } from "../config/env";

async function run() {
  console.log("🔍 Iniciando verificación de esquema...");

  // Fuerza que crashee si falta variables necesarias para REST.
  // No necesita SUPABASE_DB_URL.
  getConfig();

  try {
    const result = await verifyDatabaseSchema();
    console.log(
      `\n✅ Verificación exitosa. Tablas detectadas: ${result.tablesFound.length} / ${result.tablesRequired}`,
    );
    console.log("Tablas:");
    result.tablesFound.forEach((t) => console.log(`  - ${t}`));
    process.exit(0);
  } catch (err) {
    // Si la validacion falla, el validator ya habrá hecho throw del SchemaValidationError
    // con logs informativos.
    console.error("\n❌ La verificación falló o el esquema está incompleto.");
    process.exit(1);
  }
}

run();
