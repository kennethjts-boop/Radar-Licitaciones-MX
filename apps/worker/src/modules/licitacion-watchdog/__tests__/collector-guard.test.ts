import { lock } from "../../../core/lock";
import { getState } from "../../../core/system-state";
import { getSupabaseClient } from "../../../storage/client";
import {
  evaluateCollectorTelemetryGuard,
  shouldDeferWatchdogForCollector,
} from "../collector-guard";

jest.mock("../../../core/lock", () => ({
  lock: { isLocked: jest.fn() },
  JOB_LOCK_TTL_MS: 2 * 60 * 1000,
}));
jest.mock("../../../core/system-state", () => ({
  STATE_KEYS: { COMPRASMX_TELEMETRY: "comprasmx_telemetry" },
  getState: jest.fn(),
}));

const mockMaybeSingle = jest.fn();
const mockEq = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });
jest.mock("../../../storage/client", () => ({
  getSupabaseClient: jest.fn(() => ({ from: mockFrom })),
}));

const mockedIsLocked = jest.mocked(lock.isLocked);
const mockedGetState = jest.mocked(getState);
const mockedGetSupabaseClient = jest.mocked(getSupabaseClient);
const now = new Date("2026-07-16T06:00:00.000Z");

describe("collector guard solo-lectura y fail-open", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedIsLocked.mockReturnValue(false);
    mockedGetState.mockResolvedValue(null);
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  });

  it("pospone si el lock principal está activo sin adquirirlo ni liberarlo", async () => {
    mockedIsLocked.mockReturnValue(true);

    await expect(shouldDeferWatchdogForCollector(now)).resolves.toEqual({
      defer: true,
      reason: "collect_lock_active",
    });
    expect(mockedIsLocked).toHaveBeenCalledWith("collect-job");
    expect(mockedGetSupabaseClient).not.toHaveBeenCalled();
    expect(mockedGetState).not.toHaveBeenCalled();
  });

  it("pospone si otro proceso tiene el lock distribuido de collect-job vigente", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { updated_at: "2026-07-16T05:59:00.000Z" }, // hace 60s, dentro del TTL de 2 min
      error: null,
    });

    await expect(shouldDeferWatchdogForCollector(now)).resolves.toEqual({
      defer: true,
      reason: "collect_lock_active",
    });
    expect(mockFrom).toHaveBeenCalledWith("bot_lock");
    expect(mockedGetState).not.toHaveBeenCalled();
  });

  it("ejecuta normalmente si el lock distribuido de collect-job está vencido", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { updated_at: "2026-07-16T05:00:00.000Z" }, // hace 60 min, vencido
      error: null,
    });

    await expect(shouldDeferWatchdogForCollector(now)).resolves.toEqual({
      defer: false,
      reason: null,
    });
    expect(mockedGetState).toHaveBeenCalled();
  });

  it("ejecuta normalmente si falla la lectura del lock distribuido (fail-open)", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: new Error("bot_lock no disponible"),
    });

    await expect(shouldDeferWatchdogForCollector(now)).resolves.toEqual({
      defer: false,
      reason: null,
    });
    expect(mockedGetState).toHaveBeenCalled();
  });

  it("pospone únicamente con telemetría degradada, válida y reciente", () => {
    expect(evaluateCollectorTelemetryGuard({
      comprasmx_consecutive_failures: 7,
      last_comprasmx_error_at: "2026-07-16T05:29:57.000Z",
      last_comprasmx_success_at: "2026-07-16T01:58:38.000Z",
    }, now)).toEqual({ defer: true, reason: "collector_recently_degraded" });
  });

  it.each([
    [null],
    [{ comprasmx_consecutive_failures: "7", last_comprasmx_error_at: "fecha-inválida" }],
    [{ comprasmx_consecutive_failures: 7, last_comprasmx_error_at: "2026-07-16T04:00:00.000Z" }],
    [{
      comprasmx_consecutive_failures: 7,
      last_comprasmx_error_at: "2026-07-16T05:30:00.000Z",
      last_comprasmx_success_at: "2026-07-16T05:31:00.000Z",
    }],
  ])("ejecuta normalmente si el estado es ausente, inválido, obsoleto o recuperado", (state) => {
    expect(evaluateCollectorTelemetryGuard(state, now)).toEqual({ defer: false, reason: null });
  });

  it("ejecuta normalmente si falla la lectura del lock", async () => {
    mockedIsLocked.mockImplementation(() => { throw new Error("lock ilegible"); });
    await expect(shouldDeferWatchdogForCollector(now)).resolves.toEqual({ defer: false, reason: null });
  });

  it("ejecuta normalmente si falla la lectura de telemetría", async () => {
    mockedGetState.mockRejectedValue(new Error("DB no disponible"));
    await expect(shouldDeferWatchdogForCollector(now)).resolves.toEqual({ defer: false, reason: null });
  });
});
