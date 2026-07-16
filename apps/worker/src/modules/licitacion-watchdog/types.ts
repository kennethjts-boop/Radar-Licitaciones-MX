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
  partial: boolean;
  extractionFailure: WatchdogExtractionFailure | null;
  deploymentSha: string | null;
  tableSignatures: string[];
  documentSignature: string;
  numeroProcedimiento: string;
  expedienteUrl: string;
  uuidProcedimiento: string;
  detail: JsonObject;
  documents: WatchdogDocument[];
  visibleFields: JsonObject;
  visibleTables: VisibleTableSnapshot[];
}

export type WatchdogFailureCause = "NETWORK_INFRA" | "SITE_STRUCTURE" | "UNKNOWN";

export interface WatchdogExtractionFailure extends JsonObject {
  cause: WatchdogFailureCause;
  stage: "browser_session" | "navigation" | "data_container" | "api_responses" | "dom_stability";
  message: string;
  attempts: number;
}

export type WatchdogHealthSeverity = "DEGRADED" | "CRITICAL";

export interface WatchdogHealthState extends JsonObject {
  consecutiveFailures: number;
  cause: WatchdogFailureCause | null;
  severity: WatchdogHealthSeverity | null;
  incidentStartedAt: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
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
  kind: "baseline" | "baseline_completed" | "change";
  status: "pending" | "sent";
  messageId?: number | null;
  sentAt?: string;
  deploymentSha?: string | null;
}

export interface StructuralConfirmation extends JsonObject {
  signature: string;
  captures: number;
  confirmedAt: string;
}

export interface StoredDetectedChanges {
  changes: WatchdogChange[];
  notification: NotificationState;
  structuralConfirmation?: StructuralConfirmation;
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
  deploymentSha: string | null;
  lastCheckedAt: string | null;
  lastSuccessfulCheckAt: string | null;
  lastError: string | null;
  configuredExpedientes: string[];
  results: JsonObject;
  health: WatchdogHealthState;
}
