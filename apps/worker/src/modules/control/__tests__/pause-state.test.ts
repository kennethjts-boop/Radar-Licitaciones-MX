let persistedState: Record<string, unknown> | null = null;
let strictFailure: Error | null = null;

const mockGetState = jest.fn(async () => persistedState);
const mockSetStateStrict = jest.fn(
  async (_key: string, value: Record<string, unknown>) => {
    if (strictFailure) throw strictFailure;
    persistedState = structuredClone(value);
  },
);

jest.mock("../../../core/system-state", () => ({
  getState: mockGetState,
  setStateStrict: mockSetStateStrict,
  STATE_KEYS: {
    RADAR_PAUSE_STATE: "radar_pause_state",
  },
}));

import {
  getEffectivePause,
  getPauseState,
  pauseScope,
  resetPauseMutationQueueForTests,
  resumeScopes,
} from "../pause-state";
import {
  adminCommandsEnabled,
  isAuthorizedAdmin,
  parseAdminUserIds,
} from "../authorization";

describe("pause-state persistente", () => {
  beforeEach(() => {
    persistedState = null;
    strictFailure = null;
    jest.clearAllMocks();
    resetPauseMutationQueueForTests();
  });

  it("persiste una pausa y la vuelve a leer después de simular reinicio", async () => {
    const now = new Date("2026-07-23T16:00:00.000Z");
    await pauseScope({
      scope: "watchdog",
      minutes: 60,
      reason: "hora pico",
      pausedBy: "123",
      now,
    });

    resetPauseMutationQueueForTests();
    const afterRestart = await getEffectivePause(
      "watchdog",
      new Date("2026-07-23T16:10:00.000Z"),
    );

    expect(afterRestart).toMatchObject({
      paused: true,
      effectiveScope: "watchdog",
      msUntilResume: 50 * 60_000,
    });
    expect(mockGetState).toHaveBeenCalled();
  });

  it("mantiene scopes independientes sin pisarlos y all tiene prioridad", async () => {
    const now = new Date("2026-07-23T16:00:00.000Z");
    await pauseScope({
      scope: "watchdog",
      minutes: 30,
      reason: "watchdog",
      pausedBy: "123",
      now,
    });
    await pauseScope({
      scope: "collector",
      minutes: null,
      reason: "collector",
      pausedBy: "123",
      now,
    });
    await pauseScope({
      scope: "all",
      minutes: 10,
      reason: "todo",
      pausedBy: "123",
      now,
    });

    const state = await getPauseState(now);
    expect(Object.keys(state.scopes).sort()).toEqual([
      "all",
      "collector",
      "watchdog",
    ]);
    expect(await getEffectivePause("watchdog", now)).toMatchObject({
      paused: true,
      effectiveScope: "all",
    });

    await resumeScopes("all");
    expect(await getEffectivePause("watchdog", now)).toMatchObject({
      paused: true,
      effectiveScope: "watchdog",
    });
    expect(await getEffectivePause("collector", now)).toMatchObject({
      paused: true,
      effectiveScope: "collector",
    });
  });

  it("elimina automáticamente una pausa vencida", async () => {
    await pauseScope({
      scope: "watchdog",
      minutes: 5,
      reason: "temporal",
      pausedBy: "123",
      now: new Date("2026-07-23T16:00:00.000Z"),
    });

    const status = await getEffectivePause(
      "watchdog",
      new Date("2026-07-23T16:06:00.000Z"),
    );

    expect(status.paused).toBe(false);
    expect(persistedState).toEqual({ scopes: {} });
  });

  it("propaga el fallo de escritura y nunca confirma estado local", async () => {
    strictFailure = new Error("Supabase unavailable");
    await expect(
      pauseScope({
        scope: "all",
        minutes: 60,
        reason: "test",
        pausedBy: "123",
      }),
    ).rejects.toThrow("Supabase unavailable");
    expect(persistedState).toBeNull();
  });
});

describe("autorización administrativa", () => {
  it("es fail-closed y valida el id del usuario, no el chat", () => {
    expect(adminCommandsEnabled("")).toBe(false);
    expect(isAuthorizedAdmin(123, "")).toBe(false);
    expect(parseAdminUserIds(" 123,456,123 ")).toEqual(
      new Set(["123", "456"]),
    );
    expect(isAuthorizedAdmin(456, "123,456")).toBe(true);
    expect(isAuthorizedAdmin(-100000, "123,456")).toBe(false);
    expect(isAuthorizedAdmin(undefined, "123,456")).toBe(false);
  });
});
