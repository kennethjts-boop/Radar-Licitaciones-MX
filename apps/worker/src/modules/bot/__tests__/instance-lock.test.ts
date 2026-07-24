const mockRpc = jest.fn();
const mockSelect = jest.fn();
const mockEqInstance = jest.fn().mockReturnValue({ select: mockSelect });
const mockEqKey = jest.fn().mockReturnValue({ eq: mockEqInstance });
const mockUpdate = jest.fn().mockReturnValue({ eq: mockEqKey });
const mockFrom = jest.fn().mockReturnValue({ update: mockUpdate });

jest.mock("../../../storage/client", () => ({
  getSupabaseClient: () => ({
    rpc: mockRpc,
    from: mockFrom,
  }),
}));

import {
  acquirePollingLock,
  startHeartbeat,
  stopHeartbeat,
} from "../instance-lock";

describe("Telegram polling instance lock", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSelect.mockResolvedValue({
      data: [{ key: "telegram_polling" }],
      error: null,
    });
  });

  afterEach(() => {
    stopHeartbeat();
    jest.useRealTimers();
  });

  it("reclama el lock mediante la RPC atómica con TTL de 30 segundos", async () => {
    await expect(acquirePollingLock()).resolves.toBe(true);

    expect(mockRpc).toHaveBeenCalledWith(
      "claim_polling_lock",
      expect.objectContaining({
        p_key: "telegram_polling",
        p_instance: expect.any(String),
        p_ttl_ms: 30_000,
      }),
    );
  });

  it("devuelve false cuando otra instancia conserva el lock", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });

    await expect(acquirePollingLock()).resolves.toBe(false);
  });

  it("renueva el heartbeat cada 10 segundos solo para su instance_id", async () => {
    startHeartbeat();

    await jest.advanceTimersByTimeAsync(10_000);

    expect(mockFrom).toHaveBeenCalledWith("bot_lock");
    expect(mockUpdate).toHaveBeenCalledWith({
      updated_at: expect.any(String),
    });
    expect(mockEqKey).toHaveBeenCalledWith("key", "telegram_polling");
    expect(mockEqInstance).toHaveBeenCalledWith(
      "instance_id",
      expect.any(String),
    );
  });

  it("notifica la pérdida del lock si el heartbeat ya no actualiza filas", async () => {
    const onLockLost = jest.fn();
    mockSelect.mockResolvedValue({ data: [], error: null });

    startHeartbeat(onLockLost);
    await jest.advanceTimersByTimeAsync(10_000);

    expect(onLockLost).toHaveBeenCalledTimes(1);
  });
});
