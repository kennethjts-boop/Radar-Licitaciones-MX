/**
 * CONFIG — Variables de entorno validadas con Zod.
 * Si falta alguna variable crítica, el proceso falla al arrancar.
 */
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // Runtime
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Supabase
  SUPABASE_URL: z.string().url({ message: 'SUPABASE_URL debe ser una URL válida' }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10, { message: 'SUPABASE_SERVICE_ROLE_KEY requerido' }),
  SUPABASE_DB_URL: z.string().url({ message: 'SUPABASE_DB_URL debe ser una URL válida' }).optional(),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(10, { message: 'TELEGRAM_BOT_TOKEN requerido' }),
  TELEGRAM_CHAT_ID: z.string().min(1, { message: 'TELEGRAM_CHAT_ID requerido' }),

  // Playwright
  PLAYWRIGHT_HEADLESS: z.string().default('true').transform((v) => v === 'true'),

  // Scheduler
  COLLECT_INTERVAL_MINUTES: z.string().default('30').transform(Number),
  DAILY_SUMMARY_HOUR: z.string().default('7').transform(Number),

  // Railway / deploy
  RAILWAY_ENVIRONMENT: z.string().optional(),

  // App
  APP_TIMEZONE: z.string().default('America/Mexico_City'),
});

export type AppConfig = z.infer<typeof envSchema>;

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (_config) return _config;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`[CONFIG] Variables de entorno inválidas:\n${errors}`);
  }

  _config = result.data;
  return _config;
}

export function resetConfig(): void {
  _config = null;
}
