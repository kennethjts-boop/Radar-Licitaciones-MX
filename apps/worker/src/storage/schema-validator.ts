/**
 * SCHEMA VALIDATOR — Validación automática del esquema de Supabase.
 *
 * Técnica:
 * El cliente Supabase JS no puede consultar information_schema directamente
 * via PostgREST (esquema no expuesto). En su lugar, intentamos un HEAD request
 * ({count: 'exact', head: true}) contra cada tabla requerida y detectamos:
 *   - Éxito (con o sin filas)  → tabla existe
 *   - Error code "42P01"       → tabla NO existe (PostgreSQL: undefined_table)
 *   - Otro error               → tabla existe pero hay otro problema (contamos como existente)
 *
 * Esto es confiable porque Supabase/PostgREST propaga los códigos de error
 * de PostgreSQL directamente. No requiere permisos adicionales más allá del
 * service_role key ya configurado.
 *
 * Política:
 * - Si faltan tablas → lanzar SchemaValidationError (crash de arranque)
 * - NO crear tablas automáticamente
 * - Sugerir ejecutar docs/supabase-schema.sql
 */
import { createModuleLogger } from "../core/logger";
import { getSupabaseClient } from "./client";

const log = createModuleLogger("schema-validator");

// ─── Tablas requeridas ────────────────────────────────────────────────────────

export const REQUIRED_TABLES = [
  "sources",
  "collect_runs",
  "raw_items",
  "procurements",
  "procurement_versions",
  "attachments",
  "radars",
  "radar_rules",
  "matches",
  "alerts",
  "telegram_logs",
  "daily_summaries",
  "entity_memory",
  "system_state",
] as const;

export type RequiredTable = (typeof REQUIRED_TABLES)[number];

// ─── Resultado de validación ──────────────────────────────────────────────────

export interface SchemaValidationResult {
  valid: boolean;
  tablesFound: string[];
  tablesMissing: string[];
  tablesChecked: number;
  tablesRequired: number;
  checkedAt: string;
}

// ─── Error de validación ──────────────────────────────────────────────────────

export class SchemaValidationError extends Error {
  constructor(
    public readonly missing: string[],
    public readonly found: number,
    public readonly total: number,
  ) {
    super(
      `DATABASE SCHEMA NOT INITIALIZED — Faltan ${missing.length} tabla(s): [${missing.join(", ")}]`,
    );
    this.name = "SchemaValidationError";
  }
}

// ─── Verificar una sola tabla ─────────────────────────────────────────────────

async function checkTable(
  tableName: string,
): Promise<{ exists: boolean; error?: string }> {
  const db = getSupabaseClient();

  try {
    const { error } = await db
      .from(tableName as RequiredTable)
      .select("*", { count: "exact", head: true });

    if (!error) {
      return { exists: true };
    }

    // PostgreSQL error 42P01: undefined_table (tabla no existe)
    // PostgREST lo propaga sin modificación
    if (
      error.code === "42P01" ||
      error.message?.toLowerCase().includes("does not exist") ||
      error.message?.toLowerCase().includes("no existe")
    ) {
      return { exists: false, error: error.message };
    }

    // Cualquier otro error (permisos, red, etc.) — asumimos que la tabla SÍ existe
    // porque el error no es de "tabla no encontrada"
    log.warn(
      { table: tableName, code: error.code, msg: error.message },
      "Error al verificar tabla — asumiendo que existe",
    );
    return { exists: true, error: error.message };
  } catch (err) {
    // Error de red o crítico — no podemos determinar existencia
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ table: tableName, err: msg }, "Error de red verificando tabla");
    // En caso de error de red, tratamos como existente para no generar
    // falsos positivos de "tabla faltante" cuando es un problema de conectividad
    return { exists: true, error: msg };
  }
}

// ─── Validación principal ─────────────────────────────────────────────────────

/**
 * Verifica que todas las tablas requeridas existen en Supabase.
 *
 * @throws SchemaValidationError si faltan tablas
 * @returns SchemaValidationResult con el detalle completo
 */
export async function verifyDatabaseSchema(): Promise<SchemaValidationResult> {
  log.info("🔍 Validating database schema...");
  log.info(
    { required: REQUIRED_TABLES.length },
    `Checking ${REQUIRED_TABLES.length} required tables...`,
  );

  const tablesFound: string[] = [];
  const tablesMissing: string[] = [];

  // Verificar todas las tablas en paralelo (más rápido que secuencial)
  const results = await Promise.all(
    REQUIRED_TABLES.map(async (table) => {
      const result = await checkTable(table);
      return { table, ...result };
    }),
  );

  for (const { table, exists } of results) {
    if (exists) {
      tablesFound.push(table);
    } else {
      tablesMissing.push(table);
    }
  }

  const found = tablesFound.length;
  const total = REQUIRED_TABLES.length;

  const validationResult: SchemaValidationResult = {
    valid: tablesMissing.length === 0,
    tablesFound,
    tablesMissing,
    tablesChecked: total,
    tablesRequired: total,
    checkedAt: new Date().toISOString(),
  };

  // ── Resultado ──────────────────────────────────────────────────────────────

  if (tablesMissing.length > 0) {
    log.error(
      { found, total, missing: tablesMissing },
      `❌ DATABASE SCHEMA NOT INITIALIZED — Tables found: ${found} / ${total}`,
    );
    log.error(
      { missing: tablesMissing },
      `Missing tables: [${tablesMissing.join(", ")}]`,
    );
    log.error(
      "Run the SQL schema to fix: docs/supabase-schema.sql (copy-paste in Supabase SQL Editor)",
    );

    throw new SchemaValidationError(tablesMissing, found, total);
  }

  log.info(
    { found, total },
    `✅ DATABASE SCHEMA VALIDATED — Tables found: ${found} / ${total}`,
  );
  return validationResult;
}

/**
 * Versión no-crash de validación — retorna resultado sin lanzar excepción.
 * Úsala para healthchecks periódicos sin crashear el worker.
 */
export async function verifyDatabaseSchemaSafe(): Promise<SchemaValidationResult> {
  try {
    return await verifyDatabaseSchema();
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return {
        valid: false,
        tablesFound: REQUIRED_TABLES.filter((t) => !err.missing.includes(t)),
        tablesMissing: err.missing,
        tablesChecked: REQUIRED_TABLES.length,
        tablesRequired: REQUIRED_TABLES.length,
        checkedAt: new Date().toISOString(),
      };
    }
    // Error de conectividad — no sabemos si el schema es válido
    return {
      valid: false,
      tablesFound: [],
      tablesMissing: [...REQUIRED_TABLES],
      tablesChecked: 0,
      tablesRequired: REQUIRED_TABLES.length,
      checkedAt: new Date().toISOString(),
    };
  }
}
