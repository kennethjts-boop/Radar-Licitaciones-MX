import "dotenv/config";
import { z } from "zod";
import pino from "pino";

const envSchema = z.object({
  // Runtime
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  RADAR_DEBUG_CANDIDATES: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  // Supabase
  SUPABASE_URL: z
    .string()
    .url({ message: "SUPABASE_URL debe ser una URL válida" }),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(10, { message: "SUPABASE_SERVICE_ROLE_KEY requerido" }),
  SUPABASE_DB_URL: z
    .string()
    .url({ message: "SUPABASE_DB_URL debe ser una URL válida" })
    .optional(),

  // Telegram
  TELEGRAM_BOT_TOKEN: z
    .string()
    .min(10, { message: "TELEGRAM_BOT_TOKEN requerido" }),
  TELEGRAM_CHAT_ID: z
    .string()
    .min(1, { message: "TELEGRAM_CHAT_ID requerido" }),
  TELEGRAM_SEND_TIMEOUT_MS: z
    .string()
    .default("15000")
    .transform(Number)
    .pipe(z.number().int().min(1000)),
  TELEGRAM_MAX_RETRIES: z
    .string()
    .default("5")
    .transform(Number)
    .pipe(z.number().int().min(1).max(10)),
  TELEGRAM_INITIAL_RETRY_DELAY_MS: z
    .string()
    .default("1500")
    .transform(Number)
    .pipe(z.number().int().min(100)),
  TELEGRAM_RETRY_BACKOFF_MULTIPLIER: z
    .string()
    .default("2")
    .transform(Number)
    .pipe(z.number().min(1)),
  TELEGRAM_MAX_RETRY_DELAY_MS: z
    .string()
    .default("10000")
    .transform(Number)
    .pipe(z.number().int().min(500)),
  TELEGRAM_COMMAND_BOT_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true"),

  // Playwright & Escudo
  PLAYWRIGHT_HEADLESS: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  PLAYWRIGHT_IGNORE_HTTPS_ERRORS: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  // PROXY_ENABLED: si es false, el browser corre sin proxy aunque HTTP_PROXY/HTTPS_PROXY existan.
  PROXY_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  // HTTP_PROXY / HTTPS_PROXY: solo se usan si PROXY_ENABLED=true. Si no se configuran, dejar vacíos.
  HTTP_PROXY: z.string().optional(),
  HTTPS_PROXY: z.string().optional(),

  // Compras MX Incremental Strategy
  // COMPRASMX_SEED_URL: URL raíz del índice de licitaciones (portal buengobierno o compranet).
  COMPRASMX_SEED_URL: z
    .string()
    .url()
    .default("https://comprasmx.buengobierno.gob.mx/sitiopublico/#/"),
  COMPRASMX_MAX_LIST_PAGES: z.string().default("5").transform(Number),
  COMPRASMX_STOP_AFTER_KNOWN_STREAK: z.string().default("200").transform(Number),
  COMPRASMX_INCREMENTAL_LOOKBACK_HOURS: z
    .string()
    .default("72")
    .transform(Number),
  // Hora (0-23 en America/Mexico_City) en que se dispara el Modo 2 (Daily Recheck directo).
  COMPRASMX_DAILY_RECHECK_HOUR: z.string().default("6").transform(Number),

  // Scheduler
  COLLECT_INTERVAL_MINUTES: z.string().default("30").transform(Number),
  DAILY_SUMMARY_HOUR: z.string().default("7").transform(Number),

  // External Leads OSINT — apagado por defecto; no afecta ComprasMX si no se activa.
  ENABLE_EXTERNAL_LEADS_OSINT: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  EXTERNAL_LEADS_DRY_RUN: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  EXTERNAL_LEADS_MAX_RESULTS_PER_RUN: z
    .string()
    .default("5")
    .transform(Number),
  EXTERNAL_LEADS_MIN_SCORE: z.string().default("60").transform(Number),
  EXTERNAL_LEADS_LOOKBACK_DAYS: z.string().default("180").transform(Number),
  EXTERNAL_LEADS_MORELOS_ONLY: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  EXTERNAL_LEADS_TARGET_LOCATIONS: z
    .string()
    .optional()
    .transform((value) => {
      const locations = (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      return locations.length > 0 ? locations : undefined;
    }),
  EXTERNAL_LEADS_TELEGRAM_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  COMMERCIAL_MATCHING_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  COMMERCIAL_MATCHING_MIN_SCORE: z
    .string()
    .default("60")
    .transform(Number),
  COMMERCIAL_MATCHING_REQUIRE_TERRITORY: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  COMMERCIAL_MATCHING_DEBUG: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  EXTERNAL_LEADS_DISCOVERY_MODE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  EXTERNAL_LEADS_DEBUG_DISCARDS: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  EXTERNAL_LEADS_SAVE_LOW_SCORE_CANDIDATES: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  EXTERNAL_LEADS_MAX_RAW_RESULTS_PER_SOURCE: z
    .string()
    .default("50")
    .transform(Number),
  EXTERNAL_LEADS_SOURCE_TIMEOUT_MS: z
    .string()
    .default("15000")
    .transform(Number),

  // OpenAI
  OPENAI_API_KEY: z.string().min(10, { message: "OPENAI_API_KEY requerido" }).optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),

  // Railway / deploy
  RAILWAY_ENVIRONMENT: z.string().optional(),

  // App
  APP_TIMEZONE: z.string().default("America/Mexico_City"),

  // HTTP Server
  HEALTH_PORT: z.string().default("8080").transform(Number),
  // Token para endpoints /api/licitaciones/* (header: x-api-key)
  INTERNAL_API_KEY: z.string().min(1).optional(),

  // Alert Filter — ventanas de tiempo y límites
  ALERT_NEW_LOOKBACK_HOURS: z.string().default('48').transform(Number),
  ALERT_ACTIVE_MAX_AGE_DAYS: z.string().default('21').transform(Number),
  ALERT_DESIERTA_LOOKBACK_DAYS: z.string().default('10').transform(Number),
  ALERT_INCLUDE_HISTORICAL: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  ALERT_MAX_PER_CYCLE: z.string().default('25').transform(Number),
  DAILY_SUMMARY_MAX_ITEMS: z.string().default('40').transform(Number),
  DAILY_SUMMARY_EXCLUDE_OLD_CLOSED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof envSchema>;

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (_config) return _config;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[CONFIG] Variables de entorno inválidas:\n${errors}`);
  }

  _config = result.data;
  pino({ base: null, timestamp: pino.stdTimeFunctions.isoTime }).info(
    {
      COMPRASMX_SEED_URL: result.data.COMPRASMX_SEED_URL,
      ENABLE_EXTERNAL_LEADS_OSINT: result.data.ENABLE_EXTERNAL_LEADS_OSINT,
      RADAR_DEBUG_CANDIDATES: result.data.RADAR_DEBUG_CANDIDATES,
      NODE_ENV: result.data.NODE_ENV,
      RAILWAY_ENVIRONMENT: result.data.RAILWAY_ENVIRONMENT ?? "local",
      TELEGRAM_SEND_TIMEOUT_MS: result.data.TELEGRAM_SEND_TIMEOUT_MS,
      TELEGRAM_MAX_RETRIES: result.data.TELEGRAM_MAX_RETRIES,
      TELEGRAM_COMMAND_BOT_ENABLED: result.data.TELEGRAM_COMMAND_BOT_ENABLED,
      PLAYWRIGHT_IGNORE_HTTPS_ERRORS: result.data.PLAYWRIGHT_IGNORE_HTTPS_ERRORS,
      ALERT_MAX_PER_CYCLE: result.data.ALERT_MAX_PER_CYCLE,
    },
    "[CONFIG] variables de entorno cargadas",
  );
  return _config;
}

export function resetConfig(): void {
  _config = null;
}
