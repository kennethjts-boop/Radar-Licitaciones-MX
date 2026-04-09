/**
 * TIPOS DE BASE DE DATOS — SUPABASE
 * Interfaces que reflejan exactamente el esquema SQL de Supabase.
 * Usar para tipado en storage layer.
 */

// ─── sources ────────────────────────────────────────────────────────────────

export interface DbSource {
  id: string; // uuid
  key: string; // 'comprasmx' | 'dof' | 'institutional' | 'fallback'
  name: string;
  type: "web_scraper" | "api" | "rss" | "pdf" | "search";
  base_url: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── collect_runs ────────────────────────────────────────────────────────────

export interface DbCollectRun {
  id: string;
  source_id: string;
  collector_key: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "error" | "timeout";
  items_seen: number;
  items_created: number;
  items_updated: number;
  error_message: string | null;
  metadata_json: Record<string, unknown> | null;
}

// ─── raw_items ───────────────────────────────────────────────────────────────

export interface DbRawItem {
  id: string;
  source_id: string;
  external_id: string;
  source_url: string;
  fetched_at: string;
  raw_json: Record<string, unknown>;
  raw_text: string | null;
  fingerprint: string; // SHA-256 del raw_json serializado
  created_at: string;
}

// ─── procurements ────────────────────────────────────────────────────────────

export interface DbProcurement {
  id: string;
  source_id: string;
  external_id: string;
  raw_item_id: string | null;
  expediente_id: string | null;
  licitation_number: string | null;
  procedure_number: string | null;
  title: string;
  description: string | null;
  dependency_name: string | null;
  buying_unit: string | null;
  procedure_type: string;
  status: string;
  publication_date: string | null;
  opening_date: string | null;
  award_date: string | null;
  state: string | null;
  municipality: string | null;
  amount: number | null;
  currency: string | null;
  source_url: string;
  canonical_text: string;
  canonical_fingerprint: string;
  lightweight_fingerprint: string | null;
  last_seen_at: string;
  last_detail_checked_at: string | null;
  last_attachments_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── procurement_versions ────────────────────────────────────────────────────

export interface DbProcurementVersion {
  id: string;
  procurement_id: string;
  version_number: number;
  status: string | null;
  title: string | null;
  description: string | null;
  publication_date: string | null;
  source_url: string | null;
  fingerprint: string;
  changed_fields_json: Record<string, unknown> | null;
  raw_snapshot_json: Record<string, unknown> | null;
  created_at: string;
}

// ─── attachments ─────────────────────────────────────────────────────────────

export interface DbAttachment {
  id: string;
  procurement_id: string;
  version_id: string | null;
  file_name: string;
  file_type: string | null;
  file_url: string;
  storage_path: string | null;
  file_size_bytes: number | null;
  file_hash: string | null;
  detected_text: string | null;
  created_at: string;
}

// ─── radars ──────────────────────────────────────────────────────────────────

export interface DbRadar {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_active: boolean;
  priority: number;
  schedule_minutes: number;
  config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── radar_rules ─────────────────────────────────────────────────────────────

export interface DbRadarRule {
  id: string;
  radar_id: string;
  rule_type: string;
  field_name: string;
  operator: string;
  value: string;
  weight: number;
  is_required: boolean;
  created_at: string;
}

// ─── matches ─────────────────────────────────────────────────────────────────

export interface DbMatch {
  id: string;
  radar_id: string;
  procurement_id: string;
  match_score: number;
  match_level: string;
  matched_terms_json: string[];
  excluded_terms_json: string[];
  explanation: string;
  created_at: string;
  updated_at: string;
}

// ─── alerts ──────────────────────────────────────────────────────────────────

export interface DbAlert {
  id: string;
  radar_id: string | null;
  procurement_id: string | null;
  alert_type: string;
  telegram_message: string;
  telegram_status: "pending" | "sent" | "failed";
  telegram_message_id: number | null;
  sent_at: string | null;
  created_at: string;
}

// ─── telegram_logs ───────────────────────────────────────────────────────────

export interface DbTelegramLog {
  id: string;
  command: string;
  request_payload: Record<string, unknown> | null;
  response_payload: Record<string, unknown> | null;
  status: "ok" | "error";
  created_at: string;
}

// ─── daily_summaries ─────────────────────────────────────────────────────────

export interface DbDailySummary {
  id: string;
  summary_date: string; // YYYY-MM-DD
  total_seen: number;
  total_new: number;
  total_updated: number;
  total_matches: number;
  total_alerts: number;
  summary_text: string;
  created_at: string;
}

// ─── entity_memory ───────────────────────────────────────────────────────────

export interface DbEntityMemory {
  id: string;
  entity_type: "institution" | "person" | "product" | "geo" | "concept";
  entity_key: string;
  aliases_json: string[];
  context_terms_json: string[];
  exclusion_terms_json: string[];
  geo_terms_json: string[];
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── system_state ────────────────────────────────────────────────────────────

export interface DbSystemState {
  id: string;
  key: string;
  value_json: Record<string, unknown>;
  updated_at: string;
}
