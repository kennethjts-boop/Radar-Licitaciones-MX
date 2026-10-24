jest.mock("../ai-usage", () => {
  const actual = jest.requireActual("../ai-usage");
  return { ...actual, fetchAiUsageRows: jest.fn(async () => []) };
});

import { resetConfig } from "../../../config/env";
import { captureMidnightSnapshots, resetDeliveryGuardForTests, runDailyCostReport } from "../job";
import { reportKey, type StateStore } from "../report-state";

function memoryStore(): StateStore & { data: Map<string, any> } {
  const data = new Map<string, any>();
  return {
    data,
    insertIfAbsent: async (k, v) => (data.has(k) ? false : (data.set(k, structuredClone(v)), true)),
    read: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null),
    readMany: async (keys) => new Map(keys.filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))])),
    compareAndSet: async (k, e, v) => {
      const c = data.get(k);
      if (!c || c.status !== e.status || c.attempts !== e.attempts) return false;
      data.set(k, structuredClone(v));
      return true;
    },
    write: async (k, v) => void data.set(k, structuredClone(v)),
  };
}

const noFetch = (async () => {
  throw new Error("sin red en pruebas");
}) as unknown as typeof fetch;
const at8 = new Date("2026-10-24T14:00:00Z");
const key = reportKey("2026-10-23");

describe("runDailyCostReport", () => {
  beforeEach(() => resetDeliveryGuardForTests());

  it("no corre antes de la hora configurada", async () => {
    const store = memoryStore();
    expect(await runDailyCostReport({ store, now: new Date("2026-10-24T13:59:00Z") })).toBe("too_early");
    expect(store.data.size).toBe(0);
  });

  it("envía una vez; reinicios posteriores no reenvían", async () => {
    const store = memoryStore();
    const send = jest.fn(async () => ({ messageId: 42 }));
    const deps = { store, now: at8, fetchImpl: noFetch, send, resolveChat: async () => "123" };
    expect(await runDailyCostReport(deps)).toBe("sent");
    resetDeliveryGuardForTests(); // simula reinicio
    expect(await runDailyCostReport({ ...deps, now: new Date("2026-10-24T15:00:00Z") })).toBe("skip:sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.data.get(key)).toMatchObject({ status: "sent", messageId: 42, attempts: 1 });
    expect(store.data.get(key).metrics.date).toBe("2026-10-23");
  });

  it("Telegram entrega pero falla guardar 'sent': no se reenvía ni pasa a failed", async () => {
    const store = memoryStore();
    const realWrite = store.write;
    store.write = async (k, v: any) => {
      if (v.status === "sent") throw new Error("supabase caído");
      return realWrite(k, v);
    };
    const send = jest.fn(async () => ({ messageId: 7 }));
    const deps = { store, now: at8, fetchImpl: noFetch, send, resolveChat: async () => "123", persistRetryDelayMs: 1 };
    expect(await runDailyCostReport(deps)).toBe("sent_unpersisted");
    expect(store.data.get(key).status).toBe("claimed");

    // Mismo proceso, una hora después.
    expect(await runDailyCostReport({ ...deps, now: new Date("2026-10-24T15:00:00Z") })).toBe("skip:delivered_in_process");
    // Proceso nuevo (reinicio): la fila claimed sigue bloqueando el reenvío.
    resetDeliveryGuardForTests();
    store.write = realWrite;
    expect(await runDailyCostReport({ ...deps, now: new Date("2026-10-24T16:00:00Z") })).toBe("skip:claimed");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("timeout de Telegram queda incierto y no se reintenta", async () => {
    const store = memoryStore();
    const send = jest.fn(async () => {
      throw Object.assign(new Error("telegram.sendMessage timed out"), { name: "TimeoutError" });
    });
    const deps = { store, now: at8, fetchImpl: noFetch, send, resolveChat: async () => "123" };
    expect(await runDailyCostReport(deps)).toBe("uncertain");
    resetDeliveryGuardForTests(); // simula reinicio: decide sólo el estado persistido
    expect(await runDailyCostReport(deps)).toBe("skip:uncertain");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sin chat privado: falla antes de enviar y reintenta con límite", async () => {
    const store = memoryStore();
    const send = jest.fn(async () => ({ messageId: 1 }));
    const deps = { store, now: at8, fetchImpl: noFetch, send, resolveChat: async () => null };
    expect(await runDailyCostReport(deps)).toBe("failed");
    expect(await runDailyCostReport(deps)).toBe("failed");
    expect(await runDailyCostReport(deps)).toBe("failed");
    expect(await runDailyCostReport(deps)).toBe("skip:max_attempts");
    expect(send).not.toHaveBeenCalled();
  });

  it("corte OpenRouter guarda hora real y huella, no la clave", async () => {
    process.env.OPENROUTER_API_KEY = "clave-ficticia-de-prueba";
    resetConfig();
    const store = memoryStore();
    const fakeFetch = (async () => ({ ok: true, json: async () => ({ data: { usage: 12.5 } }) })) as unknown as typeof fetch;
    const late = new Date("2026-10-24T09:12:00Z"); // 03:12 MX
    await captureMidnightSnapshots(() => late, store, fakeFetch);
    const saved = store.data.get("cost_snapshot:openrouter:2026-10-24");
    expect(saved).toMatchObject({ usageUsd: 12.5, capturedAt: late.toISOString() });
    expect(saved.keyId).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(JSON.stringify(saved)).not.toContain("clave-ficticia");
    delete process.env.OPENROUTER_API_KEY;
    resetConfig();
  });
});
