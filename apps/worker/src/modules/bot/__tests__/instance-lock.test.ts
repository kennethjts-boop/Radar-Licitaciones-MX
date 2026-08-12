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
  buildPollingInstanceId,
  getLastSuccessfulRenewalAt,
  isPollingLockValid,
  resetPollingLockForTests,
  startHeartbeat,
  stopHeartbeat,
} from "../instance-lock";

describe("Telegram polling instance lock", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetPollingLockForTests();
    jest.clearAllMocks();
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSelect.mockResolvedValue({
      data: [{ key: "telegram_polling" }],
      error: null,
    });
  });

  afterEach(() => {
    resetPollingLockForTests();
    jest.useRealTimers();
  });

  it("genera una identidad distinta por proceso aunque Railway reutilice la réplica", () => {
    const env = {
      RAILWAY_DEPLOYMENT_ID: "deployment-1",
      RAILWAY_REPLICA_ID: "replica-1",
    };

    const first = buildPollingInstanceId(env, 100, "process-a");
    const second = buildPollingInstanceId(env, 100, "process-b");

    expect(first).not.toBe(second);
    expect(first).toContain("deployment-1:replica-1:100:process-a");
  });

  it("1. Lock adquirido correctamente establece lastSuccessfulRenewalAt", async () => {
    const now = Date.now();
    const acquired = await acquirePollingLock();

    expect(acquired).toBe(true);
    expect(getLastSuccessfulRenewalAt()).toBeGreaterThanOrEqual(now);
    expect(isPollingLockValid()).toBe(true);
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
    expect(getLastSuccessfulRenewalAt()).toBe(0);
    expect(isPollingLockValid()).toBe(false);
  });

  it("2. Heartbeat exitoso actualiza DB y timestamp local", async () => {
    await acquirePollingLock();
    const initialRenewal = getLastSuccessfulRenewalAt();

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
    expect(getLastSuccessfulRenewalAt()).toBeGreaterThanOrEqual(initialRenewal + 10_000);
    expect(isPollingLockValid()).toBe(true);
  });

  it("3. Un fallo aislado a ~10s NO declara pérdida del lock", async () => {
    const onLockLost = jest.fn();
    await acquirePollingLock();
    const t0 = getLastSuccessfulRenewalAt();

    mockSelect.mockResolvedValueOnce({
      data: null,
      error: { message: "transient network error" },
    });

    startHeartbeat(onLockLost);
    await jest.advanceTimersByTimeAsync(10_000);

    expect(onLockLost).not.toHaveBeenCalled();
    expect(isPollingLockValid()).toBe(true);
    expect(getLastSuccessfulRenewalAt()).toBe(t0);
  });

  it("4. Fallos persistentes hasta >=20s SÍ declaran pérdida", async () => {
    const onLockLost = jest.fn();
    await acquirePollingLock();

    mockSelect.mockResolvedValue({
      data: null,
      error: { message: "persistent DB down" },
    });

    startHeartbeat(onLockLost);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(onLockLost).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(10_000);
    expect(onLockLost).toHaveBeenCalledTimes(1);
    expect(isPollingLockValid()).toBe(false);
    expect(getLastSuccessfulRenewalAt()).toBe(0);
  });

  it("5. onLockLost() se ejecuta exactamente una vez e de forma idempotente", async () => {
    const onLockLost = jest.fn();
    await acquirePollingLock();

    mockSelect.mockResolvedValue({
      data: null,
      error: { message: "persistent failure" },
    });

    startHeartbeat(onLockLost);
    await jest.advanceTimersByTimeAsync(10_000);
    await jest.advanceTimersByTimeAsync(10_000);
    await jest.advanceTimersByTimeAsync(10_000);
    await jest.advanceTimersByTimeAsync(10_000);

    expect(onLockLost).toHaveBeenCalledTimes(1);
  });

  it("6. Una operación Supabase que excede el timeout no puede bloquear la lógica", async () => {
    const onLockLost = jest.fn();
    await acquirePollingLock();

    // Supabase promise that never resolves
    mockSelect.mockReturnValue(new Promise(() => {}));

    startHeartbeat(onLockLost);

    // At 10s: heartbeat starts, Supabase query hangs for 5s (times out at 15s)
    await jest.advanceTimersByTimeAsync(10_000);
    await jest.advanceTimersByTimeAsync(5_000); // 15s elapsed
    expect(onLockLost).not.toHaveBeenCalled();

    // At 20s: next heartbeat check detects elapsed >= 20s and triggers lock lost
    await jest.advanceTimersByTimeAsync(5_000); // 20s total elapsed
    expect(onLockLost).toHaveBeenCalledTimes(1);
  });

  it("10. El segundo proceso solo puede adquirir el lock conforme al TTL existente de DB", async () => {
    const onLockLost = jest.fn();
    await acquirePollingLock();

    // Process 1 loses DB connection
    mockSelect.mockResolvedValue({ data: null, error: { message: "down" } });
    startHeartbeat(onLockLost);

    // Advance 20s: Process 1 surrenders leadership
    await jest.advanceTimersByTimeAsync(20_000);
    expect(onLockLost).toHaveBeenCalledTimes(1);

    // Process 2 tries to claim lock at T=25s while DB lock hasn't reached 30s TTL
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    const process2Attempt1 = await acquirePollingLock();
    expect(process2Attempt1).toBe(false);

    // Process 2 tries at T=31s after DB 30s TTL expires
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    const process2Attempt2 = await acquirePollingLock();
    expect(process2Attempt2).toBe(true);
  });
});

