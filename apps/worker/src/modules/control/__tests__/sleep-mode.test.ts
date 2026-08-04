import { getEffectiveRadarMode, enableSleepMode, wakeFromSleepMode } from "../sleep-mode";
import { STATE_KEYS, getState, setStateStrict, deleteState } from "../../../core/system-state";

jest.mock("../../../storage/client", () => {
  const mockUpdate = jest.fn().mockImplementation(() => ({
    eq: jest.fn().mockResolvedValue({ error: null }),
    neq: jest.fn().mockResolvedValue({ error: null }),
  }));
  const mockSelect = jest.fn().mockImplementation(() => ({
    data: [
      { key: "capufe_emergencia", is_active: true },
      { key: "capufe_oportunidades", is_active: true },
    ],
    error: null,
  }));
  return {
    getSupabaseClient: jest.fn(() => ({
      from: jest.fn((table: string) => {
        if (table === "radars" || table === "sources") {
          return {
            select: mockSelect,
            update: mockUpdate,
          };
        }
        return {};
      }),
    })),
  };
});

jest.mock("../../../core/system-state", () => {
  const store = new Map<string, any>();
  return {
    STATE_KEYS: {
      RADAR_MODE: "radar_mode",
      RADAR_PAUSE_SNAPSHOT: "radar_pause_snapshot",
    },
    getState: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setStateStrict: jest.fn((key: string, val: any) => {
      store.set(key, val);
      return Promise.resolve();
    }),
    deleteState: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

jest.mock("../../../config/env", () => ({
  getConfig: () => ({
    RADAR_MODE: "full",
    LOG_LEVEL: "info",
  }),
}));

describe("sleep-mode control module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("getEffectiveRadarMode respeta la precedencia: system_state > env > full", async () => {
    // 1. Inicialmente "full" por default/env
    let mode = await getEffectiveRadarMode();
    expect(mode).toBe("full");

    // 2. Si system_state.radar_mode = "watchdog_only", debe tener la máxima prioridad
    await setStateStrict(STATE_KEYS.RADAR_MODE, "watchdog_only");
    mode = await getEffectiveRadarMode();
    expect(mode).toBe("watchdog_only");

    // 3. Al eliminar system_state.radar_mode vuelve a "full"
    await deleteState(STATE_KEYS.RADAR_MODE);
    mode = await getEffectiveRadarMode();
    expect(mode).toBe("full");
  });

  it("enableSleepMode crea el snapshot y activa el modo dormido", async () => {
    const res = await enableSleepMode();
    expect(res.mode).toBe("watchdog_only");
    expect(res.snapshotCreated).toBe(true);
    expect(res.message).toContain("Modo dormido");

    const mode = await getEffectiveRadarMode();
    expect(mode).toBe("watchdog_only");

    const snapshot = (await getState(STATE_KEYS.RADAR_PAUSE_SNAPSHOT)) as any;
    expect(snapshot).toBeDefined();
    expect(snapshot.previous_mode).toBe("full");
  });

  it("enableSleepMode NO sobrescribe un snapshot previamente existente", async () => {
    // Activar sleep mode por primera vez
    await enableSleepMode();
    const firstSnapshot = await getState(STATE_KEYS.RADAR_PAUSE_SNAPSHOT);

    // Activar sleep mode por segunda vez
    const secondRes = await enableSleepMode();
    expect(secondRes.snapshotCreated).toBe(false);
    expect(secondRes.alreadySlept).toBe(true);

    const secondSnapshot = await getState(STATE_KEYS.RADAR_PAUSE_SNAPSHOT);
    expect(secondSnapshot).toEqual(firstSnapshot);
  });

  it("wakeFromSleepMode restaura el estado y elimina las claves de system_state", async () => {
    await enableSleepMode();
    expect(await getEffectiveRadarMode()).toBe("watchdog_only");

    const wakeRes = await wakeFromSleepMode();
    expect(wakeRes.mode).toBe("full");
    expect(wakeRes.message).toContain("Todo despierto");

    const modeAfter = await getEffectiveRadarMode();
    expect(modeAfter).toBe("full");

    const snapshotAfter = await getState(STATE_KEYS.RADAR_PAUSE_SNAPSHOT);
    expect(snapshotAfter).toBeNull();
  });
});
