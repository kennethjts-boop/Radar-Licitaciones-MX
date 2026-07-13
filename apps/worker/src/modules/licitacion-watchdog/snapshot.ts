import { createHash } from "crypto";
import { fromZonedTime } from "date-fns-tz";
import { MX_TIMEZONE } from "../../core/time";
import type {
  JsonObject,
  JsonValue,
  WatchdogChange,
  WatchdogDocument,
  WatchdogSnapshot,
  VisibleTableSnapshot,
} from "./types";

const DATE_KEY = /(?:^|_)(?:fecha|date|created_at|modified_at)|At$/i;
const MEXICO_LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const MEXICO_DISPLAY_DATE_TIME = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/;
const MEXICO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDate(value: string): string {
  const display = value.match(MEXICO_DISPLAY_DATE_TIME);
  if (display) {
    const [, day, month, year, hour, minute] = display;
    return fromZonedTime(`${year}-${month}-${day}T${hour}:${minute}:00`, MX_TIMEZONE).toISOString();
  }
  if (MEXICO_LOCAL_DATE_TIME.test(value) || MEXICO_DATE_ONLY.test(value)) {
    return fromZonedTime(value, MX_TIMEZONE).toISOString();
  }
  return value;
}

export function normalizeSnapshotValue(value: unknown, key = ""): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const normalized = normalizeWhitespace(value);
    return DATE_KEY.test(key) ? normalizeDate(normalized) : normalized;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSnapshotValue(item, key));
  }
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .filter((childKey) => !["pid", "msg"].includes(childKey))
      .sort()
      .reduce<JsonObject>((acc, childKey) => {
        acc[childKey] = normalizeSnapshotValue(
          (value as Record<string, unknown>)[childKey],
          childKey,
        );
        return acc;
      }, {});
  }
  return String(value);
}

export function normalizeSnapshot(snapshot: WatchdogSnapshot): WatchdogSnapshot {
  return normalizeSnapshotValue(snapshot) as WatchdogSnapshot;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function tableContentSignature(table: VisibleTableSnapshot): string {
  return hashJson({ headers: table.headers, rows: table.rows });
}

export function tableContentSignatures(tables: VisibleTableSnapshot[]): string[] {
  return tables.map(tableContentSignature);
}

export function documentContentSignature(documents: WatchdogDocument[]): string {
  return hashJson(documents);
}

export function snapshotStructureSignature(snapshot: WatchdogSnapshot): string {
  return hashJson({
    visibleTables: snapshot.visibleTables,
    documents: snapshot.documents,
  });
}

function comparableSnapshot(snapshot: WatchdogSnapshot): JsonObject {
  const {
    partial: _partial,
    deploymentSha: _deploymentSha,
    tableSignatures: _tableSignatures,
    documentSignature: _documentSignature,
    ...comparable
  } = snapshot;
  return comparable;
}

export function hashSnapshot(snapshot: WatchdogSnapshot): string {
  return hashJson(comparableSnapshot(snapshot));
}

function sameValue(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffValues(
  previous: JsonValue | undefined,
  current: JsonValue | undefined,
  path: string,
  changes: WatchdogChange[],
): void {
  if (sameValue(previous, current)) return;
  if (previous === undefined) {
    changes.push({ kind: "added", path, previous, current });
    return;
  }
  if (current === undefined) {
    changes.push({ kind: "removed", path, previous, current });
    return;
  }
  if (Array.isArray(previous) && Array.isArray(current)) {
    const max = Math.max(previous.length, current.length);
    for (let index = 0; index < max; index++) {
      diffValues(previous[index], current[index], `${path}[${index}]`, changes);
    }
    return;
  }
  if (
    typeof previous === "object" && previous !== null && !Array.isArray(previous) &&
    typeof current === "object" && current !== null && !Array.isArray(current)
  ) {
    const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
    for (const key of [...keys].sort()) {
      diffValues(previous[key], current[key], path ? `${path}.${key}` : key, changes);
    }
    return;
  }
  changes.push({ kind: "modified", path, previous, current });
}

function documentMap(documents: WatchdogDocument[]): Map<string, WatchdogDocument> {
  return new Map(documents.map((document) => [document.id, document]));
}

export function diffSnapshots(previous: WatchdogSnapshot, current: WatchdogSnapshot): WatchdogChange[] {
  const changes: WatchdogChange[] = [];
  const previousWithoutDocuments = { ...comparableSnapshot(previous), documents: [] };
  const currentWithoutDocuments = { ...comparableSnapshot(current), documents: [] };
  diffValues(previousWithoutDocuments, currentWithoutDocuments, "", changes);

  const previousDocuments = documentMap(previous.documents);
  const currentDocuments = documentMap(current.documents);

  for (const [id, document] of currentDocuments) {
    const oldDocument = previousDocuments.get(id);
    if (!oldDocument) {
      changes.push({
        kind: "document_added",
        path: `documents.${id}`,
        previous: undefined,
        current: document,
        document,
      });
      continue;
    }
    diffValues(oldDocument, document, `documents.${id}`, changes);
  }
  for (const [id, document] of previousDocuments) {
    if (!currentDocuments.has(id)) {
      changes.push({
        kind: "document_removed",
        path: `documents.${id}`,
        previous: document,
        current: undefined,
        document,
      });
    }
  }
  return changes;
}
