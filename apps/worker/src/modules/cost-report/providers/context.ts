export interface ProviderEnv {
  OPENAI_ADMIN_KEY?: string;
  OPENAI_PROJECT_ID?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_KEY_DEDICATED?: boolean;
  RAILWAY_API_TOKEN?: string;
  RAILWAY_PROJECT_ID?: string;
  RAILWAY_SERVICE_ID?: string;
}

export interface ProviderContext {
  /** Día MX reportado (YYYY-MM-DD). */
  date: string;
  startUtc: Date;
  endUtc: Date;
  env: ProviderEnv;
  fetch: typeof fetch;
  timeoutMs: number;
}
