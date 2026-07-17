import { getState, setState } from "../../../core/system-state";
import { shouldDeferWatchdogForCollector } from "../collector-guard";
import { extractWatchdogSnapshot } from "../extractor";
import { notifyWatchdogHealthIfNeeded } from "../health";
import { resetWatchdogLockForTests, runLicitacionWatchdog } from "../job";
import {
  getLatestSnapshot,
  insertSnapshot,
  markNotificationSent,
  resolveExpediente,
} from "../repository";
import { hashSnapshot } from "../snapshot";
import { sendPendingNotification } from "../telegram";
import type { WatchdogDocument, WatchdogSnapshot, WatchdogSnapshotRow } from "../types";

jest.mock("../../../core/system-state", () => ({
  STATE_KEYS: {
    WATCHDOG_TELEMETRY: "licitacion_watchdog_telemetry",
    COMPRASMX_TELEMETRY: "comprasmx_telemetry",
  },
  getState: jest.fn().mockResolvedValue(null),
  setState: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../collector-guard", () => ({
  shouldDeferWatchdogForCollector: jest.fn().mockResolvedValue({ defer: false, reason: null }),
}));
jest.mock("../extractor", () => ({
  classifyWatchdogFailure: jest.fn().mockReturnValue("NETWORK_INFRA"),
  extractWatchdogSnapshot: jest.fn(),
  watchdogErrorMessage: jest.fn((error: unknown) =>
    error instanceof Error ? error.message : "Valor no Error lanzado sin mensaje seguro"),
  watchdogErrorType: jest.fn((error: unknown) =>
    error instanceof Error ? error.name : "NonErrorThrown"),
}));
jest.mock("../health", () => ({
  EMPTY_WATCHDOG_HEALTH: {
    consecutiveFailures: 0,
    cause: null,
    severity: null,
    incidentStartedAt: null,
    lastFailureAt: null,
    lastSuccessAt: null,
    lastFailureStage: null,
    lastFailureType: null,
    lastFailureMessage: null,
  },
  notifyWatchdogHealthIfNeeded: jest.fn().mockResolvedValue(false),
  transitionWatchdogHealth: jest.fn((previous) => previous),
}));
jest.mock("../repository", () => ({
  getLatestSnapshot: jest.fn(),
  insertSnapshot: jest.fn(),
  markNotificationSent: jest.fn().mockResolvedValue(undefined),
  resolveExpediente: jest.fn(),
}));
jest.mock("../telegram", () => ({ sendPendingNotification: jest.fn() }));

const mockedExtract = jest.mocked(extractWatchdogSnapshot);
const mockedLatest = jest.mocked(getLatestSnapshot);
const mockedInsert = jest.mocked(insertSnapshot);
const mockedMarkSent = jest.mocked(markNotificationSent);
const mockedResolve = jest.mocked(resolveExpediente);
const mockedSend = jest.mocked(sendPendingNotification);
const mockedSetState = jest.mocked(setState);
const mockedGetState = jest.mocked(getState);
const mockedGuard = jest.mocked(shouldDeferWatchdogForCollector);
const mockedNotifyHealth = jest.mocked(notifyWatchdogHealthIfNeeded);

function documents(count: number): WatchdogDocument[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `doc-${index}`,
    name: `Documento ${index}.pdf`,
    description: null,
    type: "ANEXO",
    createdAt: null,
    modifiedAt: null,
    sizeBytes: 1,
    url: `https://example.com/doc-${index}`,
    isActa: false,
  }));
}

function snapshot(partidas = 12, documentCount = 30): WatchdogSnapshot {
  return {
    partial: false,
    extractionFailure: null,
    deploymentSha: "test-sha",
    tableSignatures: [],
    documentSignature: "test-documents",
    numeroProcedimiento: "PROC-1",
    expedienteUrl: "https://comprasmx.example/detalle/uuid/procedimiento",
    uuidProcedimiento: "uuid",
    detail: {},
    documents: documents(documentCount),
    visibleFields: {},
    visibleTables: [
      { headers: ["Dato"], rows: [["estable"]] },
      {
        headers: ["Núm.", "Partida específica"],
        rows: Array.from({ length: partidas }, (_, index) => [String(index + 1), "35301"]),
      },
    ],
  };
}

function row(value: WatchdogSnapshot): WatchdogSnapshotRow {
  return {
    id: "baseline-id",
    numero_procedimiento: value.numeroProcedimiento,
    snapshot_hash: hashSnapshot(value),
    snapshot_json: value,
    detected_changes: {
      changes: [],
      notification: { kind: "baseline", status: "sent" },
    },
    created_at: "2026-07-13T14:00:00.000Z",
  };
}

describe("licitacion-watchdog job structural guard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetState.mockResolvedValue(null);
    mockedGuard.mockResolvedValue({ defer: false, reason: null });
    resetWatchdogLockForTests();
    mockedResolve.mockResolvedValue({
      expedienteUrl: "https://comprasmx.example/detalle/uuid/procedimiento",
      uuidProcedimiento: "uuid",
    });
  });

  it("no persiste ni notifica la primera pérdida masiva y solo la acepta tras confirmación", async () => {
    const previous = snapshot();
    const reduced = snapshot(4, 10);
    const latest = row(previous);
    mockedLatest.mockResolvedValue(latest);
    mockedExtract.mockResolvedValue(reduced);
    const inserted = row(reduced);
    inserted.id = "confirmed-id";
    inserted.detected_changes.notification = { kind: "change", status: "pending" };
    mockedInsert.mockResolvedValue(inserted);
    mockedSend.mockResolvedValue(321);

    await runLicitacionWatchdog(["PROC-1"]);

    expect(mockedInsert).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalled();
    expect(mockedMarkSent).not.toHaveBeenCalled();
    expect(mockedSetState).toHaveBeenLastCalledWith(
      "licitacion_watchdog_telemetry",
      expect.objectContaining({
        status: "error",
        results: expect.objectContaining({
          "PROC-1": expect.objectContaining({ status: "confirmation_pending" }),
        }),
      }),
    );

    await runLicitacionWatchdog(["PROC-1"]);

    expect(mockedInsert).toHaveBeenCalledTimes(1);
    expect(mockedInsert).toHaveBeenCalledWith(expect.objectContaining({
      structuralConfirmation: expect.objectContaining({ captures: 2 }),
    }));
    expect(mockedSend).toHaveBeenCalledWith(inserted);
    expect(mockedMarkSent).toHaveBeenCalledWith(inserted, 321);
  });

  it("trata como unchanged un baseline válido con hash de la versión anterior", async () => {
    const current = snapshot();
    const latest = row(structuredClone(current));
    latest.snapshot_hash = "hash-legado-que-incluía-metadatos";
    mockedLatest.mockResolvedValue(latest);
    mockedExtract.mockResolvedValue(current);

    await runLicitacionWatchdog(["PROC-1"]);

    expect(mockedInsert).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalled();
    expect(mockedSetState).toHaveBeenLastCalledWith(
      "licitacion_watchdog_telemetry",
      expect.objectContaining({
        status: "ok",
        results: expect.objectContaining({
          "PROC-1": expect.objectContaining({ status: "unchanged", hashMigrated: true }),
        }),
      }),
    );
  });

  it("no compara ni persiste un snapshot parcial", async () => {
    const partial = snapshot();
    partial.partial = true;
    partial.extractionFailure = {
      cause: "SITE_STRUCTURE",
      stage: "annex_pagination",
      errorType: "Error",
      message: "anexos ComprasMX página 2: HTTP 401",
      attempts: 1,
    };
    mockedExtract.mockResolvedValue(partial);

    await runLicitacionWatchdog(["PROC-1"]);

    expect(mockedLatest).not.toHaveBeenCalled();
    expect(mockedInsert).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalled();
    expect(mockedSetState).toHaveBeenLastCalledWith(
      "licitacion_watchdog_telemetry",
      expect.objectContaining({
        status: "error",
        results: expect.objectContaining({
          "PROC-1": expect.objectContaining({
            status: "partial",
            cause: "SITE_STRUCTURE",
            stage: "annex_pagination",
            errorType: "Error",
          }),
        }),
      }),
    );
  });

  it("si una dependencia inesperada rechaza, el job siempre resuelve y contiene Telegram global", async () => {
    mockedGuard.mockRejectedValueOnce(new Error("guard inesperadamente rechazó"));

    await expect(runLicitacionWatchdog(["PROC-1"])).resolves.toBeUndefined();

    expect(mockedExtract).not.toHaveBeenCalled();
    expect(mockedNotifyHealth).toHaveBeenCalledTimes(1);
    expect(mockedSetState).toHaveBeenLastCalledWith(
      "licitacion_watchdog_telemetry",
      expect.objectContaining({ status: "error" }),
    );
  });
});
