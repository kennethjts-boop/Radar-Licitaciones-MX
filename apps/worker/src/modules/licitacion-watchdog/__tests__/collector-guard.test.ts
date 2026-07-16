import { lock } from "../../../core/lock";
import { getState } from "../../../core/system-state";
import {
  evaluateCollectorTelemetryGuard,
  shouldDeferWatchdogForCollector,
} from "../collector-guard";

jest.mock("../../../core/lock", () => ({
  lock: { isLocked: jest.fn() },
}));
jest.mock("../../../core/system-state", () => ({
  STATE_KEYS: { COMPRASMX_TELEMETRY: "comprasmx_telemetry" },
  getState: jest.fn(),
}));

const mockedIsLocked = jest.mocked(lock.isLocked);
const mockedGetState = jest.mocked(getState);
const now = new Date("2026-07-16T06:00:00.000Z");

describe("collector guard solo-lectura y fail-open", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedIsLocked.mockReturnValue(false);
    mockedGetState.mockResolvedValue(null);
  });

  it("pospone si el lock principal está activo sin adquirirlo ni liberarlo", async () => {
    mockedIsLocked.mockReturnValue(true);

    await expect(shouldDeferWatchdogForCollector(now)).resolves.toEqual({
      defer: true,
      reason: "collect_lock_active",
    });
    expect(mockedIsLocked).toHaveBeenCalledWith("collect-job");
    expect(mockedGetState).not.toHaveBeenCalled();
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
