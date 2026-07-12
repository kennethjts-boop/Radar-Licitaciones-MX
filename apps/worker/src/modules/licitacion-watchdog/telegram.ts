import { sendTelegramMessage } from "../../alerts/telegram.alerts";
import { formatMexicoDate } from "../../core/time";
import type { JsonValue, WatchdogChange, WatchdogSnapshotRow } from "./types";

const MAX_DISPLAY_LENGTH = 700;
const MAX_CHANGES_BODY_LENGTH = 2_800;

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function display(value: JsonValue | undefined): string {
  if (value === undefined) return "∅";
  if (value === null) return "null";
  const rendered = typeof value === "object" ? JSON.stringify(value) : String(value);
  return rendered.length > MAX_DISPLAY_LENGTH
    ? `${rendered.slice(0, MAX_DISPLAY_LENGTH)}…`
    : rendered;
}

function changeLine(change: WatchdogChange): string {
  if (change.kind === "document_added" && change.document) {
    const link = change.document.url || "https://comprasmx.buengobierno.gob.mx/sitiopublico/";
    return `• 📄 Nuevo documento: <a href="${escapeHtml(link)}">${escapeHtml(change.document.name)}</a>`;
  }
  if (change.kind === "document_removed" && change.document) {
    return `• 📄 Documento retirado: ${escapeHtml(change.document.name)}`;
  }
  return `• <b>${escapeHtml(change.path || "expediente")}</b>: ${escapeHtml(display(change.previous))} → ${escapeHtml(display(change.current))}`;
}

export function formatBaselineMessage(row: WatchdogSnapshotRow): string {
  return [
    `✅ Watchdog activo para <code>${escapeHtml(row.numero_procedimiento)}</code> — baseline registrado`,
    `<a href="${escapeHtml(row.snapshot_json.expedienteUrl)}">Ver expediente en ComprasMX</a>`,
  ].join("\n");
}

export function formatChangeMessages(row: WatchdogSnapshotRow): string[] {
  const changes = row.detected_changes.changes;
  const groups: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;
  for (const line of changes.map(changeLine)) {
    if (current.length > 0 && currentLength + line.length + 1 > MAX_CHANGES_BODY_LENGTH) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(line);
    currentLength += line.length + 1;
  }
  if (current.length > 0 || groups.length === 0) groups.push(current);

  return groups.map((group, index) => [
    `🚨 <b>WATCHDOG CAPUFE — ${escapeHtml(row.numero_procedimiento)}</b>`,
    `Cambios detectados (${formatMexicoDate(row.created_at, "dd/MM/yyyy HH:mm")} CDMX)${groups.length > 1 ? ` — parte ${index + 1}/${groups.length}` : ""}:`,
    "",
    ...group,
    "",
    `<a href="${escapeHtml(row.snapshot_json.expedienteUrl)}">Ver expediente en ComprasMX</a>`,
  ].join("\n"));
}

export async function sendPendingNotification(row: WatchdogSnapshotRow): Promise<number | null> {
  const messages = row.detected_changes.notification.kind === "baseline"
    ? [formatBaselineMessage(row)]
    : formatChangeMessages(row);
  let lastMessageId: number | null = null;
  for (const message of messages) {
    lastMessageId = await sendTelegramMessage(message, "HTML");
  }
  return lastMessageId;
}
