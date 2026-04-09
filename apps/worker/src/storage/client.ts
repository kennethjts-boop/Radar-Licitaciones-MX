/**
 * SUPABASE CLIENT — Singleton del cliente de base de datos.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env';

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const config = getConfig();
  _client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _client;
}

export function resetSupabaseClient(): void {
  _client = null;
}
