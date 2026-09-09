const mockRpc = jest.fn();

jest.mock("../../storage/client", () => ({
  getSupabaseClient: () => ({ rpc: mockRpc }),
}));

jest.mock("../../modules/bot/instance-lock", () => ({
  buildPollingInstanceId: () => "test-instance-id",
}));

import { lock, withLock, withDistributedLock, JOB_LOCK_TTL_MS } from "../lock";

describe("withLock (lock local en memoria)", () => {
  afterEach(() => {
    // Limpia cualquier lock que haya quedado colgado entre tests.
    lock.release("some-lock");
    lock.release("collect-job");
  });

  it("ejecuta fn y libera el lock al terminar", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    const result = await withLock("some-lock", "job", fn);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(lock.isLocked("some-lock")).toBe(false);
  });

  it("retorna null si el lock ya está activo, sin invocar fn", async () => {
    lock.acquire("some-lock", "job-a");
    const fn = jest.fn().mockResolvedValue("ok");

    const result = await withLock("some-lock", "job-b", fn);

    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    lock.release("some-lock");
  });

  it("libera el lock incluso si fn lanza", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("boom"));
    await expect(withLock("some-lock", "job", fn)).rejects.toThrow("boom");
    expect(lock.isLocked("some-lock")).toBe(false);
  });
});

describe("withDistributedLock (lock de dos capas: memoria + Supabase bot_lock)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lock.release("collect-job");
  });

  afterEach(() => {
    lock.release("collect-job");
    jest.useRealTimers();
  });

  it("REGRESIÓN: un lock local vigente de hace 3 min (> TTL distribuido de 2 min) sigue rechazando al mismo proceso", async () => {
    // El timeout de "huérfano" del lock en memoria debe seguir usando el
    // default largo (25 min), no el ttlMs corto del distribuido — de lo
    // contrario, un collect que dure más de ~2 min (normal con Playwright)
    // haría que la propia capa 1 declarara su lock expirado y lo concediera
    // de nuevo al MISMO proceso (p.ej. un collect manual desde Telegram
    // mientras corre el programado), justo el solapamiento que esta capa
    // existe para bloquear.
    jest.useFakeTimers();
    lock.acquire("collect-job", "ciclo-programado");
    jest.advanceTimersByTime(3 * 60 * 1000); // 3 min > TTL distribuido (2 min)

    const fn = jest.fn().mockResolvedValue("no debería correr");
    const result = await withDistributedLock("collect-job", "collect-manual-telegram", fn);

    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    // Ni siquiera debió intentar tocar Supabase: la capa 1 la rechazó antes.
    expect(mockRpc).not.toHaveBeenCalled();
    // El lock del ciclo programado sigue en pie.
    expect(lock.isLocked("collect-job")).toBe(true);

    lock.release("collect-job");
  });

  it("adquiere el lock distribuido, ejecuta fn y libera ambas capas", async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === "claim_polling_lock") return Promise.resolve({ data: true, error: null });
      if (fnName === "release_job_lock") return Promise.resolve({ data: true, error: null });
      throw new Error(`rpc inesperado: ${fnName}`);
    });

    const fn = jest.fn().mockResolvedValue("resultado");
    const result = await withDistributedLock("collect-job", "main-collect", fn);

    expect(result).toBe("resultado");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      "claim_polling_lock",
      expect.objectContaining({
        p_key: "collect-job",
        p_instance: "test-instance-id",
        p_ttl_ms: JOB_LOCK_TTL_MS,
      }),
    );
    expect(mockRpc).toHaveBeenCalledWith("release_job_lock", {
      p_key: "collect-job",
      p_instance: "test-instance-id",
    });
    // Ambas capas quedan libres para el siguiente ciclo.
    expect(lock.isLocked("collect-job")).toBe(false);
  });

  it("rechaza la ejecución si otra instancia tiene el lock vigente (RPC devuelve false)", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    const fn = jest.fn();

    const result = await withDistributedLock("collect-job", "main-collect", fn);

    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    // No se reclamó el lock distribuido, así que tampoco se debe intentar liberarlo.
    expect(mockRpc).not.toHaveBeenCalledWith("release_job_lock", expect.anything());
    // La capa local también se libera para no bloquear reintentos del propio proceso.
    expect(lock.isLocked("collect-job")).toBe(false);
  });

  it("adquiere el lock cuando el TTL previo venció (RPC lo permite vía ON CONFLICT)", async () => {
    // La lógica de "TTL vencido" vive en la función SQL claim_polling_lock;
    // desde JS se observa simplemente como que la RPC concede el lock.
    mockRpc.mockImplementation((fnName: string) =>
      fnName === "claim_polling_lock"
        ? Promise.resolve({ data: true, error: null })
        : Promise.resolve({ data: true, error: null }),
    );

    const fn = jest.fn().mockResolvedValue("ok");
    const result = await withDistributedLock("collect-job", "main-collect", fn);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("solo el dueño libera el lock: release_job_lock se llama con el instance_id propio", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    await withDistributedLock("collect-job", "main-collect", async () => "ok");

    const releaseCall = mockRpc.mock.calls.find(([fnName]) => fnName === "release_job_lock");
    expect(releaseCall).toBeDefined();
    expect(releaseCall?.[1]).toEqual({
      p_key: "collect-job",
      p_instance: "test-instance-id",
    });
  });

  it("fail-closed: si la RPC de claim lanza, retorna null y NO ejecuta fn", async () => {
    mockRpc.mockRejectedValue(new Error("Supabase no responde"));
    const fn = jest.fn();

    const result = await withDistributedLock("collect-job", "main-collect", fn);

    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(lock.isLocked("collect-job")).toBe(false);
  });

  it("fail-closed: si la RPC de claim devuelve error (sin excepción), retorna null y NO ejecuta fn", async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error("db error") });
    const fn = jest.fn();

    const result = await withDistributedLock("collect-job", "main-collect", fn);

    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("renueva el lock distribuido mientras fn corre y limpia el interval en finally", async () => {
    jest.useFakeTimers();
    mockRpc.mockResolvedValue({ data: true, error: null });

    let resolveFn: (() => void) | undefined;
    const fn = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFn = () => resolve("listo");
        }),
    );

    const promise = withDistributedLock("collect-job", "main-collect", fn);

    // Deja que se resuelva el claim inicial (microtask) antes de avanzar timers.
    await Promise.resolve();
    await Promise.resolve();

    const claimCallsBeforeRenewal = mockRpc.mock.calls.filter(
      ([fnName]) => fnName === "claim_polling_lock",
    ).length;
    expect(claimCallsBeforeRenewal).toBe(1);

    // Avanza dos intervalos de renovación (~30s cada uno).
    await jest.advanceTimersByTimeAsync(30_000);
    await jest.advanceTimersByTimeAsync(30_000);

    const claimCallsAfterRenewal = mockRpc.mock.calls.filter(
      ([fnName]) => fnName === "claim_polling_lock",
    ).length;
    expect(claimCallsAfterRenewal).toBeGreaterThanOrEqual(3); // 1 inicial + 2 renovaciones

    resolveFn?.();
    const result = await promise;
    expect(result).toBe("listo");

    // Tras terminar, ya no debe haber más renovaciones aunque avance el reloj.
    const claimCallsAtEnd = mockRpc.mock.calls.filter(
      ([fnName]) => fnName === "claim_polling_lock",
    ).length;
    await jest.advanceTimersByTimeAsync(60_000);
    const claimCallsAfterMoreTime = mockRpc.mock.calls.filter(
      ([fnName]) => fnName === "claim_polling_lock",
    ).length;
    expect(claimCallsAfterMoreTime).toBe(claimCallsAtEnd);
  });

  it("limpia el interval de renovación en finally aunque fn lance", async () => {
    jest.useFakeTimers();
    mockRpc.mockResolvedValue({ data: true, error: null });

    const fn = jest.fn().mockRejectedValue(new Error("fn boom"));

    await expect(withDistributedLock("collect-job", "main-collect", fn)).rejects.toThrow(
      "fn boom",
    );

    const claimCallsAtEnd = mockRpc.mock.calls.filter(
      ([fnName]) => fnName === "claim_polling_lock",
    ).length;

    await jest.advanceTimersByTimeAsync(120_000);

    const claimCallsAfter = mockRpc.mock.calls.filter(
      ([fnName]) => fnName === "claim_polling_lock",
    ).length;
    expect(claimCallsAfter).toBe(claimCallsAtEnd);
    expect(lock.isLocked("collect-job")).toBe(false);
  });
});
