import {
  sendTelegramMessageWithReceipt,
  type TelegramDeliveryReceipt,
} from "../../alerts/telegram.alerts";
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

type RowClassification = "NUEVA FILA" | "MODIFICADA" | "ELIMINADA";

interface TableRowChangeGroup {
  tableIndex: number;
  rowIndex: number;
  changes: WatchdogChange[];
}

const TABLE_ROW_PATH = /^visibleTables\[(\d+)]\.rows\[(\d+)](?:\[(\d+)])?$/;

function normalizedHeader(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function headerIndex(headers: string[], ...needles: string[]): number {
  const normalizedNeedles = needles.map(normalizedHeader);
  return headers.findIndex((header) => {
    const normalized = normalizedHeader(header);
    return normalizedNeedles.some((needle) => normalized.includes(needle));
  });
}

function valueAt(row: string[], index: number, fallback = "N/D"): string {
  return index >= 0 && row[index]?.trim() ? row[index].trim() : fallback;
}

function compactScope(description: string): string {
  const normalized = normalizedHeader(description);
  const scopes: string[] = [];
  if (normalized.includes("fonadin")) scopes.push("FONADIN");
  if (normalized.includes("mexico") && normalized.includes("puebla")) scopes.push("México-Puebla");
  if (normalized.includes("red capufe")) scopes.push("CAPUFE");
  return scopes.length > 0 ? scopes.join(" + ") : "Red no especificada";
}

function compactService(description: string): string {
  const normalized = normalizedHeader(description);
  const preventive = normalized.includes("preventiv");
  const corrective = normalized.includes("correctiv");
  if (preventive && !corrective) return "Solo preventivo";
  if (preventive && corrective) return "Preventivo + correctivo";
  if (corrective) return "Solo correctivo";
  return "Servicio";
}

function isPartidasTable(headers: string[]): boolean {
  return headers.some((header) => normalizedHeader(header).includes("partida especifica")) &&
    headers.some((header) => normalizedHeader(header).includes("descripcion detallada"));
}

function classifyRow(group: TableRowChangeGroup): RowClassification {
  const exactRowChange = group.changes.find((change) => change.path ===
    `visibleTables[${group.tableIndex}].rows[${group.rowIndex}]`);
  if (exactRowChange?.kind === "added" && exactRowChange.previous === undefined) return "NUEVA FILA";
  if (exactRowChange?.kind === "removed" && exactRowChange.current === undefined) return "ELIMINADA";
  return "MODIFICADA";
}

function rowValues(row: WatchdogSnapshotRow, group: TableRowChangeGroup): string[] {
  const classification = classifyRow(group);
  const exactRowChange = group.changes.find((change) => change.path ===
    `visibleTables[${group.tableIndex}].rows[${group.rowIndex}]`);
  const changeValue = classification === "ELIMINADA" ? exactRowChange?.previous : exactRowChange?.current;
  if (Array.isArray(changeValue)) return changeValue.map((value) => String(value ?? ""));
  return row.snapshot_json.visibleTables[group.tableIndex]?.rows[group.rowIndex] ?? [];
}

function formatTableRow(row: WatchdogSnapshotRow, group: TableRowChangeGroup): string {
  const table = row.snapshot_json.visibleTables[group.tableIndex];
  const headers = table?.headers ?? [];
  const values = rowValues(row, group);
  const classification = classifyRow(group);

  if (isPartidasTable(headers)) {
    const number = valueAt(values, headerIndex(headers, "núm", "numero"), String(group.rowIndex + 1));
    const cucop = valueAt(values, headerIndex(headers, "partida específica", "clave cucop"));
    const detail = valueAt(values, headerIndex(headers, "descripción detallada"), "");
    return `• Partida ${escapeHtml(number)} (${classification}) — CUCOP ${escapeHtml(cucop)} — ${escapeHtml(compactScope(detail))} — ${escapeHtml(compactService(detail))}`;
  }

  const compactCells = values
    .map((value, index) => `${headers[index] || `Columna ${index + 1}`}: ${value}`)
    .filter((value) => !value.endsWith(": "))
    .slice(0, 4)
    .join(" — ");
  return `• Tabla ${group.tableIndex + 1}, fila ${group.rowIndex + 1} (${classification})${compactCells ? ` — ${escapeHtml(compactCells)}` : ""}`;
}

function buildChangeLines(row: WatchdogSnapshotRow): string[] {
  const tableGroups = new Map<string, TableRowChangeGroup>();
  const genericChanges: WatchdogChange[] = [];

  for (const change of row.detected_changes.changes) {
    const match = change.path.match(TABLE_ROW_PATH);
    if (!match) {
      genericChanges.push(change);
      continue;
    }
    const tableIndex = Number(match[1]);
    const rowIndex = Number(match[2]);
    const key = `${tableIndex}:${rowIndex}`;
    const group = tableGroups.get(key) ?? { tableIndex, rowIndex, changes: [] };
    group.changes.push(change);
    tableGroups.set(key, group);
  }

  const orderedGroups = [...tableGroups.values()].sort((a, b) =>
    a.tableIndex - b.tableIndex || a.rowIndex - b.rowIndex,
  );
  const lines: string[] = [];

  if (row.detected_changes.notification.kind === "baseline_completed") {
    const populatedTables = new Map<number, TableRowChangeGroup[]>();
    for (const group of orderedGroups.filter((item) => classifyRow(item) === "NUEVA FILA")) {
      const current = populatedTables.get(group.tableIndex) ?? [];
      current.push(group);
      populatedTables.set(group.tableIndex, current);
    }
    for (const [tableIndex, groups] of populatedTables) {
      const table = row.snapshot_json.visibleTables[tableIndex];
      if (table && groups.length === table.rows.length && groups.length > 0) {
        const label = isPartidasTable(table.headers) ? "Tabla de partidas" : `Tabla ${tableIndex + 1}`;
        lines.push(`<b>${label} poblada: ${groups.length} partidas detectadas</b>`);
      }
    }
  }

  lines.push(...orderedGroups.map((group) => formatTableRow(row, group)));
  lines.push(...genericChanges.map(changeLine));
  return lines;
}

export function formatBaselineMessage(row: WatchdogSnapshotRow): string {
  return [
    `✅ Watchdog activo para <code>${escapeHtml(row.numero_procedimiento)}</code> — baseline registrado`,
    `<a href="${escapeHtml(row.snapshot_json.expedienteUrl)}">Ver expediente en ComprasMX</a>`,
  ].join("\n");
}

export function formatChangeMessages(row: WatchdogSnapshotRow): string[] {
  const lines = buildChangeLines(row);
  const groups: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;
  for (const line of lines) {
    if (current.length > 0 && currentLength + line.length + 1 > MAX_CHANGES_BODY_LENGTH) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(line);
    currentLength += line.length + 1;
  }
  if (current.length > 0 || groups.length === 0) groups.push(current);

  const baselineCompleted = row.detected_changes.notification.kind === "baseline_completed";
  return groups.map((group, index) => [
    baselineCompleted
      ? `✅ <b>[BASELINE_COMPLETADO] WATCHDOG CAPUFE — ${escapeHtml(row.numero_procedimiento)}</b>`
      : `🚨 <b>[CAMBIO_DETECTADO] WATCHDOG CAPUFE — ${escapeHtml(row.numero_procedimiento)}</b>`,
    `${baselineCompleted ? "Baseline completado" : "Cambios detectados"} (${formatMexicoDate(row.created_at, "dd/MM/yyyy HH:mm")} CDMX)${groups.length > 1 ? ` — parte ${index + 1}/${groups.length}` : ""}:`,
    "",
    ...group,
    "",
    `<a href="${escapeHtml(row.snapshot_json.expedienteUrl)}">Ver expediente en ComprasMX</a>`,
  ].join("\n"));
}

export async function sendPendingNotification(row: WatchdogSnapshotRow): Promise<TelegramDeliveryReceipt> {
  const messages = row.detected_changes.notification.kind === "baseline"
    ? [formatBaselineMessage(row)]
    : formatChangeMessages(row);
  let lastReceipt: TelegramDeliveryReceipt | null = null;
  for (const message of messages) {
    lastReceipt = await sendTelegramMessageWithReceipt(message, "HTML");
  }
  if (!lastReceipt) throw new Error("Notificación watchdog vacía; no existe comprobante de entrega");
  return lastReceipt;
}
