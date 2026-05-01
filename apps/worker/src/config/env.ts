/**
 * CONFIG — Variables de entorno validadas con Zod.
 * Si falta alguna variable crítica, el proceso falla al arrancar.
 */
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

  // Playwright & Escudo
  PLAYWRIGHT_HEADLESS: z
    .string()
    .default("true")
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

  // OpenAI
  OPENAI_API_KEY: z.string().min(10, { message: "OPENAI_API_KEY requerido" }).optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),

  // Railway / deploy
  RAILWAY_ENVIRONMENT: z.string().optional(),

  // App
  APP_TIMEZONE: z.string().default("America/Mexico_City"),

  // HTTP Server
  HEALTH_PORT: z.string().default("8080").transform(Number),
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
  // Log crítico usando pino directamente — sin pasar por getLogger() para evitar
  // dependencia circular durante la inicialización.
  pino({ base: null, timestamp: pino.stdTimeFunctions.isoTime }).info(
    {
      COMPRASMX_SEED_URL: result.data.COMPRASMX_SEED_URL,
      NODE_ENV: result.data.NODE_ENV,
      RAILWAY_ENVIRONMENT: result.data.RAILWAY_ENVIRONMENT ?? "local",
    },
    "[CONFIG] variables de entorno cargadas",
  );
  return _config;
}

export function resetConfig(): void {
  _config = null;
}
