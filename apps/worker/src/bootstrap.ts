/**
 * BOOTSTRAP — Secuencia de arranque del worker.
 *
 * Orden de arranque:
 * 1. Conectar a Supabase — validar primer query real
 * 2. Validar schema de DB — FALLA si faltan tablas (SchemaValidationError)
 * 3. Conectar a Telegram — validar token con getMe()
 * 4. Actualizar healthcheck en memoria con estado real
 * 5. Registrar boot en system_state
 * 6. Enviar mensaje de boot a Telegram
 *
 * Política de fallos:
 * - Si Supabase NO conecta    → crash inmediato (sin DB no hay sistema)
 * - Si schema falta tablas    → crash inmediato con lista de tablas faltantes
 * - Si Telegram falla         → advertencia, continúa (monitor puede funcionar sin bot)
 * - Si falla env              → crash inmediato (Zod ya lo gestiona)
 *
 * La razón del crash en DB: sin schema válido, cualquier operación de storage
 * fallará de forma silenciosa o con errores confusos. Es mejor fallar rápido
 * con un mensaje claro que dejar correr un worker roto.
 */
import TelegramBot from "node-telegram-bot-api";
import { getConfig } from "./config/env";
import { createModuleLogger } from "./core/logger";
import { healthTracker } from "./core/healthcheck";
import { recordWorkerBoot, recordHealthcheck } from "./core/system-state";
import { nowISO, formatMexicoDate } from "./core/time";
import { getActiveRadars } from "./radars/index";
import {
  verifyDatabaseSchema,
  SchemaValidationError,
  REQUIRED_TABLES,
} from "./storage/schema-validator";

const log = createModuleLogger("bootstrap");

// ─── Resultado de bootstrap ───────────────────────────────────────────────────

export interface BootstrapResult {
  supabaseOk: boolean;
  schemaValid: boolean;
  tablesFound: number;
  tablesMissing: string[];
  telegramOk: boolean;
  botUsername: string | null;
  sourceId: string | null;
  bootedAt: string;
}

// ─── 1. Conectar a Supabase ───────────────────────────────────────────────────

async function connectSupabase(): Promise<{
  ok: boolean;
  sourceId: string | null;
}> {
  log.info("Connecting to Supabase...");

  try {
    const { getSupabaseClient } = await import("./storage/client");
    const db = getSupabaseClient();

    // Ping real — leer la tabla sources que es la más estable del sistema
    const { error } = await db
      .from("sources")
      .select("id", { count: "exact", head: true });

    if (error && error.code !== "PGRST116") {
      // Si el error es 42P01 (tabla no existe), la conexión funciona pero el schema no está
      // Esto lo detectará verifyDatabaseSchema() en el siguiente paso
      if (error.code === "42P01") {
        log.warn("Supabase connection OK — but tables not yet initialized");
        return { ok: true, sourceId: null };
      }

      log.error(
        { code: error.code, msg: error.message },
        "❌ Supabase connection FAILED",
      );
      return { ok: false, sourceId: null };
    }

    log.info("✅ Supabase connected");

    // Intentar leer source ID de comprasmx para el heartbeat job
    const { data, error: srcErr } = await db
      .from("sources")
      .select("id, key")
      .eq("key", "comprasmx")
      .single();

    const sourceId = !srcErr && data?.id ? data.id : null;

    return { ok: true, sourceId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg }, "❌ Supabase connection FAILED — network error");
    return { ok: false, sourceId: null };
  }
}

// ─── 2. Validar schema ────────────────────────────────────────────────────────

async function validateSchema(): Promise<{
  valid: boolean;
  tablesFound: number;
  tablesMissing: string[];
}> {
  log.info("Validating database schema...");

  try {
    const result = await verifyDatabaseSchema();
    return {
      valid: true,
      tablesFound: result.tablesFound.length,
      tablesMissing: [],
    };
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      // El error ya tiene el log de error dentro de verifyDatabaseSchema()
      return {
        valid: false,
        tablesFound: REQUIRED_TABLES.length - err.missing.length,
        tablesMissing: err.missing,
      };
    }
    // Error inesperado durante validación
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg }, "❌ Error inesperado validando schema");
    return {
      valid: false,
      tablesFound: 0,
      tablesMissing: [...REQUIRED_TABLES],
    };
  }
}

// ─── 3. Verificar Telegram ────────────────────────────────────────────────────

async function checkTelegram(
  token: string,
): Promise<{ ok: boolean; username: string | null }> {
  log.info("Connecting to Telegram...");

  try {
    const bot = new TelegramBot(token, { polling: false });
    const me = await bot.getMe();
    log.info({ username: me.username, id: me.id }, "✅ Telegram connected");
    return { ok: true, username: me.username ?? null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg }, "❌ Telegram connection FAILED");
    return { ok: false, username: null };
  }
}

// ─── 4. Mensaje de boot ───────────────────────────────────────────────────────

async function sendBootMessage(
  token: string,
  chatId: string,
  result: BootstrapResult,
): Promise<void> {
  try {
    const bot = new TelegramBot(token, { polling: false });
    const config = getConfig();
    const radars = getActiveRadars();

    const dbLine = result.supabaseOk
      ? `🗄 DB: ✅ Conectada`
      : `🗄 DB: ❌ Sin conexión`;

    const schemaLine = result.schemaValid
      ? `🧱 Schema: ✅ Validado (${result.tablesFound} / ${REQUIRED_TABLES.length} tablas)`
      : `🧱 Schema: ❌ INCOMPLETO — faltan: [${result.tablesMissing.join(", ")}]`;

    const tgLine = result.telegramOk
      ? `📨 Bot: ✅ @${result.botUsername}`
      : `📨 Bot: ❌ Error`;

    const systemReady =
      result.supabaseOk && result.schemaValid && result.telegramOk;

    const message = [
      `🚀 <b>Worker iniciado — Radar Licitaciones MX</b>`,
      "",
      `🌍 Entorno: <b>${config.NODE_ENV}</b>`,
      `🚂 Railway: <b>${config.RAILWAY_ENVIRONMENT ?? "local"}</b>`,
      dbLine,
      schemaLine,
      tgLine,
      `📡 Radares activos: <b>${radars.length}</b>`,
      `⏱ Ciclos: cada <b>${config.COLLECT_INTERVAL_MINUTES} min</b>`,
      `🕐 Boot: ${formatMexicoDate(result.bootedAt)}`,
      "",
      systemReady
        ? "✅ Sistema listo — all systems go"
        : "⚠️ Sistema iniciado con advertencias — revisar logs",
    ].join("\n");

    await bot.sendMessage(chatId, message, { parse_mode: "HTML" });
    log.info("📩 Boot message sent to Telegram");
  } catch (err) {
    log.warn({ err }, "Could not send boot message — continuing");
  }
}

// ─── Bootstrap principal ──────────────────────────────────────────────────────

export async function bootstrap(): Promise<BootstrapResult> {
  const config = getConfig();
  const bootedAt = nowISO();

  log.info(
    {
      env: config.NODE_ENV,
      railway: config.RAILWAY_ENVIRONMENT ?? "local",
    },
    "🔧 Starting bootstrap sequence...",
  );

  log.info("Env validated");
  log.info("Runtime DB mode: Supabase REST");
  log.info("SUPABASE_DB_URL not required for runtime");

  // ── Paso 1: Conectar Supabase ────────────────────────────────────────────────
  const { ok: supabaseOk, sourceId } = await connectSupabase();

  if (!supabaseOk) {
    // Sin conexión a DB no podemos operar. Crash inmediato.
    log.fatal(
      "FATAL: Cannot connect to Supabase. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
    throw new Error("FATAL: Supabase connection failed — cannot start worker");
  }

  healthTracker.setDbHealth("ok");

  // ── Paso 2: Validar schema ───────────────────────────────────────────────────
  const {
    valid: schemaValid,
    tablesFound,
    tablesMissing,
  } = await validateSchema();

  if (!schemaValid) {
    // Schema inválido = crash inmediato. Sin tablas no hay operaciones posibles.
    healthTracker.setDbSchemaValid(
      false,
      tablesFound,
      tablesMissing,
      REQUIRED_TABLES.length,
    );

    log.fatal(
      {
        tablesFound,
        tablesMissing,
        totalRequired: REQUIRED_TABLES.length,
      },
      [
        "FATAL: DATABASE SCHEMA NOT INITIALIZED",
        `Tables found: ${tablesFound} / ${REQUIRED_TABLES.length}`,
        `Missing: [${tablesMissing.join(", ")}]`,
        "Fix: Run docs/supabase-schema.sql in Supabase SQL Editor",
        "URL: https://supabase.com → Your project → SQL Editor → New query → paste file → Run",
      ].join("\n"),
    );

    throw new SchemaValidationError(
      tablesMissing,
      tablesFound,
      REQUIRED_TABLES.length,
    );
  }

  healthTracker.setDbSchemaValid(true, tablesFound, [], REQUIRED_TABLES.length);
  log.info(
    { tablesFound, total: REQUIRED_TABLES.length },
    "✅ Database schema validated",
  );

  // ── Paso 3: Conectar Telegram ────────────────────────────────────────────────
  const { ok: telegramOk, username: botUsername } = await checkTelegram(
    config.TELEGRAM_BOT_TOKEN,
  );
  healthTracker.setTelegramHealth(telegramOk ? "ok" : "down");

  const result: BootstrapResult = {
    supabaseOk,
    schemaValid,
    tablesFound,
    tablesMissing,
    telegramOk,
    botUsername,
    sourceId,
    bootedAt,
  };

  // ── Paso 4: Registrar en system_state ────────────────────────────────────────
  await recordWorkerBoot("0.1.0");

  const allGood = supabaseOk && schemaValid && telegramOk;
  await recordHealthcheck({
    healthy: allGood,
    worker_status: allGood ? "ok" : "degraded",
    db_connected: supabaseOk,
    db_schema_valid: schemaValid,
    telegram_connected: telegramOk,
    runtime_db_mode: "supabase-rest",
  });

  // ── Paso 5: Enviar mensaje de boot ───────────────────────────────────────────
  if (telegramOk) {
    await sendBootMessage(
      config.TELEGRAM_BOT_TOKEN,
      config.TELEGRAM_CHAT_ID,
      result,
    );
  } else {
    log.warn("Skipping boot message — Telegram not available");
  }

  // ── Paso 6: Log resumen ──────────────────────────────────────────────────────

  log.info(
    {
      supabase: supabaseOk,
      schemaValid,
      tablesFound: `${tablesFound}/${REQUIRED_TABLES.length}`,
      telegram: telegramOk,
      bot: botUsername ?? "N/A",
      sourceId: sourceId ?? "pendiente (seed comprasmx no encontrado)",
      radarsActive: getActiveRadars().length,
    },
    allGood
      ? "✅ Bootstrap completed — all systems go"
      : "⚠️ Bootstrap completed with warnings",
  );

  return result;
}
