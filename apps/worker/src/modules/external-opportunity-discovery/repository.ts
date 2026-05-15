import { v4 as uuidv4 } from "uuid";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { getSupabaseClient } from "../../storage/client";
import type { ExternalLead } from "./types";

const log = createModuleLogger("external-leads-repo");

let schemaReady = false;

async function tableExists(tableName: string): Promise<boolean> {
  const { error } = await getSupabaseClient()
    .from(tableName)
    .select("*", { count: "exact", head: true });

  if (!error) return true;

  const message = error.message?.toLowerCase() ?? "";
  return !(
    error.code === "42P01" ||
    message.includes("does not exist") ||
    message.includes("no existe")
  );
}

export async function ensureExternalLeadSchema(): Promise<void> {
  if (schemaReady) return;

  const hasLeads = await tableExists("external_leads");
  const hasAlerts = await tableExists("external_lead_alerts");
  if (hasLeads && hasAlerts) {
    schemaReady = true;
    return;
  }

  throw new Error(
    "external_leads schema missing. Run docs/migrations/12_external_leads_osint.sql once; runtime uses Supabase REST only.",
  );
}

function toDbRecord(lead: ExternalLead): Record<string, unknown> {
  return {
    source_name: lead.sourceName,
    source_url: lead.sourceUrl,
    detected_at: lead.detectedAt,
    title: lead.title,
    organization_name: lead.organizationName,
    organization_type: lead.organizationType,
    state: lead.state,
    municipality: lead.municipality,
    sector: lead.sector,
    vertical: lead.vertical,
    matched_keywords: lead.matchedKeywords,
    evidence_text: lead.evidenceText,
    contact_area: lead.contactArea,
    contact_name_public_optional: lead.contactNamePublicOptional,
    contact_email_public_optional: lead.contactEmailPublicOptional,
    contact_phone_public_optional: lead.contactPhonePublicOptional,
    estimated_interest_score: lead.estimatedInterestScore,
    opportunity_type: lead.opportunityType,
    confidence: lead.confidence,
    next_action: lead.nextAction,
    status: lead.status,
    amount_visible: lead.amountVisible,
    buyer_area_identified: lead.buyerAreaIdentified,
    is_official_source: lead.isOfficialSource,
    source_published_at: lead.sourcePublishedAt,
    raw_json: lead.raw,
    fingerprint_hash: lead.fingerprintHash,
  };
}

export async function upsertExternalLead(
  lead: ExternalLead,
): Promise<{ id: string; isNew: boolean }> {
  await ensureExternalLeadSchema();

  const db = getSupabaseClient();
  const { data: existing, error: findError } = await db
    .from("external_leads")
    .select("id, status")
    .eq("fingerprint_hash", lead.fingerprintHash)
    .maybeSingle();

  if (findError && findError.code !== "PGRST116") {
    throw new Error(`Error buscando external_lead: ${findError.message}`);
  }

  const record = toDbRecord(lead);

  if (existing?.id) {
    const { error } = await db
      .from("external_leads")
      .update({
        ...record,
        status: existing.status ?? lead.status,
        updated_at: nowISO(),
      })
      .eq("id", existing.id);

    if (error) {
      throw new Error(`Error actualizando external_lead: ${error.message}`);
    }

    return { id: existing.id, isNew: false };
  }

  const id = uuidv4();
  const { error } = await db
    .from("external_leads")
    .insert({
      id,
      ...record,
      created_at: nowISO(),
      updated_at: nowISO(),
    });

  if (error) {
    throw new Error(`Error insertando external_lead: ${error.message}`);
  }

  return { id, isNew: true };
}

export async function hasExternalLeadAlert(
  fingerprintHash: string,
): Promise<boolean> {
  await ensureExternalLeadSchema();

  const { data, error } = await getSupabaseClient()
    .from("external_lead_alerts")
    .select("id")
    .eq("fingerprint_hash", fingerprintHash)
    .limit(1);

  if (error) return false;
  return (data ?? []).length > 0;
}

export async function createExternalLeadAlert(
  leadId: string,
  fingerprintHash: string,
  telegramMessage: string,
): Promise<string> {
  await ensureExternalLeadSchema();

  const id = uuidv4();
  const { error } = await getSupabaseClient()
    .from("external_lead_alerts")
    .insert({
      id,
      external_lead_id: leadId,
      fingerprint_hash: fingerprintHash,
      telegram_message: telegramMessage,
      telegram_status: "pending",
      created_at: nowISO(),
    });

  if (error) {
    throw new Error(`Error creando alerta external_lead: ${error.message}`);
  }

  return id;
}

export async function markExternalLeadAlertSent(
  alertId: string,
  leadId: string,
  telegramMessageId: number,
): Promise<void> {
  await ensureExternalLeadSchema();

  const db = getSupabaseClient();
  const sentAt = nowISO();
  const { error } = await db
    .from("external_lead_alerts")
    .update({
      telegram_status: "sent",
      telegram_message_id: telegramMessageId,
      sent_at: sentAt,
    })
    .eq("id", alertId);

  if (error) {
    throw new Error(`Error marcando alerta external_lead: ${error.message}`);
  }

  await db
    .from("external_leads")
    .update({ status: "alert_sent", updated_at: sentAt })
    .eq("id", leadId);
}

export async function markExternalLeadAlertFailed(
  alertId: string,
): Promise<void> {
  await ensureExternalLeadSchema();

  const { error } = await getSupabaseClient()
    .from("external_lead_alerts")
    .update({ telegram_status: "failed" })
    .eq("id", alertId);

  if (error) {
    throw new Error(`Error marcando alerta external_lead fallida: ${error.message}`);
  }
}
