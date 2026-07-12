export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface WatchdogDocument extends JsonObject {
  id: string;
  name: string;
  description: string | null;
  type: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  sizeBytes: number | null;
  url: string;
  isActa: boolean;
}

export interface VisibleTableSnapshot extends JsonObject {
  headers: string[];
  rows: string[][];
}

export interface WatchdogSnapshot extends JsonObject {
  numeroProcedimiento: string;
  expedienteUrl: string;
  uuidProcedimiento: string;
  detail: JsonObject;
  documents: WatchdogDocument[];
  visibleFields: JsonObject;
  visibleTables: VisibleTableSnapshot[];
}

export type WatchdogChangeKind = "added" | "removed" | "modified" | "document_added" | "document_removed";

export interface WatchdogChange {
  kind: WatchdogChangeKind;
  path: string;
  previous: JsonValue | undefined;
  current: JsonValue | undefined;
  document?: WatchdogDocument;
}

export interface NotificationState {
  kind: "baseline" | "change";
  status: "pending" | "sent";
  messageId?: number | null;
  sentAt?: string;
}

export interface StoredDetectedChanges {
  changes: WatchdogChange[];
  notification: NotificationState;
}

export interface WatchdogSnapshotRow {
  id: string;
  numero_procedimiento: string;
  snapshot_hash: string;
  snapshot_json: WatchdogSnapshot;
  detected_changes: StoredDetectedChanges;
  created_at: string;
}

export interface WatchdogTelemetry extends JsonObject {
  status: "idle" | "running" | "ok" | "error";
  lastCheckedAt: string | null;
  lastSuccessfulCheckAt: string | null;
  lastError: string | null;
  configuredExpedientes: string[];
  results: JsonObject;
}
