jest.mock("../ai-usage", () => {
  const actual = jest.requireActual("../ai-usage");
  return { ...actual, fetchAiUsageRows: jest.fn(async () => []) };
});

import { runDailyCostReport } from "../job";
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
    expect(await runDailyCostReport({ ...deps, now: new Date("2026-10-24T15:00:00Z") })).toBe("skip:sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.data.get(key)).toMatchObject({ status: "sent", messageId: 42, attempts: 1 });
    expect(store.data.get(key).metrics.date).toBe("2026-10-23");
  });

  it("timeout de Telegram queda incierto y no se reintenta", async () => {
    const store = memoryStore();
    const send = jest.fn(async () => {
      throw Object.assign(new Error("telegram.sendMessage timed out"), { name: "TimeoutError" });
    });
    const deps = { store, now: at8, fetchImpl: noFetch, send, resolveChat: async () => "123" };
    expect(await runDailyCostReport(deps)).toBe("uncertain");
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
});
