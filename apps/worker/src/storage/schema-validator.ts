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

export const REQUIRED_COLUMNS: Partial<Record<RequiredTable, readonly string[]>> = {
  matches: [
    "id",
    "radar_id",
    "procurement_id",
    "match_score",
    "opportunity_score",
    "document_score",
    "match_level",
    "matched_terms_json",
    "excluded_terms_json",
    "explanation",
    "created_at",
    "updated_at",
  ],
} as const;

// ─── Resultado de validación ──────────────────────────────────────────────────

export interface SchemaValidationResult {
  valid: boolean;
  tablesFound: string[];
  tablesMissing: string[];
  columnsMissing: Record<string, string[]>;
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
    public readonly columnsMissing: Record<string, string[]> = {},
  ) {
    const missingColumns = Object.entries(columnsMissing)
      .filter(([, columns]) => columns.length > 0)
      .map(([table, columns]) => `${table}: [${columns.join(", ")}]`);
    const details = [
      missing.length > 0 ? `Faltan ${missing.length} tabla(s): [${missing.join(", ")}]` : null,
      missingColumns.length > 0 ? `Faltan columnas criticas: ${missingColumns.join("; ")}` : null,
    ].filter(Boolean).join(" — ");

    super(
      `DATABASE SCHEMA NOT INITIALIZED — ${details}`,
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

function isMissingColumnError(error: { code?: string; message?: string }): boolean {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    message.includes("column") && (
      message.includes("does not exist") ||
      message.includes("no existe") ||
      message.includes("could not find") ||
      message.includes("schema cache")
    )
  );
}

async function checkColumn(
  tableName: RequiredTable,
  columnName: string,
): Promise<{ exists: boolean; error?: string }> {
  const db = getSupabaseClient();

  try {
    const { error } = await db
      .from(tableName)
      .select(columnName, { count: "exact", head: true });

    if (!error) {
      return { exists: true };
    }

    if (isMissingColumnError(error)) {
      return { exists: false, error: error.message };
    }

    log.warn(
      {
        table: tableName,
        column: columnName,
        code: error.code,
        msg: error.message,
      },
      "Error al verificar columna — asumiendo que existe",
    );
    return { exists: true, error: error.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      { table: tableName, column: columnName, err: msg },
      "Error de red verificando columna",
    );
    return { exists: true, error: msg };
  }
}

async function checkRequiredColumns(
  tableName: RequiredTable,
): Promise<{ table: RequiredTable; missing: string[] }> {
  const requiredColumns: readonly string[] = REQUIRED_COLUMNS[tableName] ?? [];
  if (requiredColumns.length === 0) {
    return { table: tableName, missing: [] };
  }

  const results = await Promise.all(
    requiredColumns.map(async (column) => {
      const result = await checkColumn(tableName, column);
      return { column, ...result };
    }),
  );

  return {
    table: tableName,
    missing: results
      .filter((result) => !result.exists)
      .map((result) => result.column),
  };
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
  const columnsMissing: Record<string, string[]> = {};

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

  const columnResults = await Promise.all(
    (Object.keys(REQUIRED_COLUMNS) as RequiredTable[])
      .filter((table) => tablesFound.includes(table))
      .map((table) => checkRequiredColumns(table)),
  );

  for (const { table, missing } of columnResults) {
    if (missing.length > 0) {
      columnsMissing[table] = missing;
    }
  }

  const found = tablesFound.length;
  const total = REQUIRED_TABLES.length;

  const validationResult: SchemaValidationResult = {
    valid: tablesMissing.length === 0 && Object.keys(columnsMissing).length === 0,
    tablesFound,
    tablesMissing,
    columnsMissing,
    tablesChecked: total,
    tablesRequired: total,
    checkedAt: new Date().toISOString(),
  };

  // ── Resultado ──────────────────────────────────────────────────────────────

  if (tablesMissing.length > 0 || Object.keys(columnsMissing).length > 0) {
    log.error(
      { found, total, missing: tablesMissing, columnsMissing },
      `❌ DATABASE SCHEMA NOT INITIALIZED — Tables found: ${found} / ${total}`,
    );
    if (tablesMissing.length > 0) {
      log.error(
        { missing: tablesMissing },
        `Missing tables: [${tablesMissing.join(", ")}]`,
      );
    }
    if (Object.keys(columnsMissing).length > 0) {
      log.error(
        { columnsMissing },
        "Missing critical columns in Supabase schema",
      );
    }
    log.error(
      "Run the SQL schema to fix: docs/supabase-schema.sql (copy-paste in Supabase SQL Editor)",
    );

    throw new SchemaValidationError(tablesMissing, found, total, columnsMissing);
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
        columnsMissing: err.columnsMissing,
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
      columnsMissing: {},
      tablesChecked: 0,
      tablesRequired: REQUIRED_TABLES.length,
      checkedAt: new Date().toISOString(),
    };
  }
}
