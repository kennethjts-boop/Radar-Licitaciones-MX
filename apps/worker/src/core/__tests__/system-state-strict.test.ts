const mockUpsert = jest.fn();
const mockSingle = jest.fn();
const mockEq = jest.fn(() => ({ single: mockSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({
  upsert: mockUpsert,
  select: mockSelect,
}));

jest.mock("../../storage/client", () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

import { setStateStrict, STATE_KEYS } from "../system-state";

describe("setStateStrict", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsert.mockResolvedValue({ error: null });
    mockSingle.mockResolvedValue({
      data: { value_json: { scopes: { all: { resumeAt: null } } } },
      error: null,
    });
  });

  it("hace upsert y verifica el valor persistido", async () => {
    const value = { scopes: { all: { resumeAt: null } } };
    await expect(
      setStateStrict(STATE_KEYS.RADAR_PAUSE_STATE, value),
    ).resolves.toBeUndefined();
    expect(mockUpsert).toHaveBeenCalled();
    expect(mockSelect).toHaveBeenCalledWith("value_json");
  });

  it("lanza cuando falla el upsert", async () => {
    mockUpsert.mockResolvedValue({
      error: { message: "write failed" },
    });
    await expect(
      setStateStrict(STATE_KEYS.RADAR_PAUSE_STATE, { scopes: {} }),
    ).rejects.toThrow("write failed");
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("lanza cuando el read-back no coincide", async () => {
    mockSingle.mockResolvedValue({
      data: { value_json: { scopes: {} } },
      error: null,
    });
    await expect(
      setStateStrict(STATE_KEYS.RADAR_PAUSE_STATE, {
        scopes: { watchdog: { resumeAt: null } },
      }),
    ).rejects.toThrow("no coincide");
  });
});
