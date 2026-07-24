import { watchdogSchedulerDelayMs } from "../scheduler";

describe("licitacion-watchdog scheduler backoff", () => {
  it("mantiene intervalo base al estar sano o ante el primer fallo", () => {
    const base = 15 * 60_000;
    expect(watchdogSchedulerDelayMs(base, 0)).toBe(base);
    expect(watchdogSchedulerDelayMs(base, 1)).toBe(base);
  });

  it("aplica backoff exponencial con tope de 120 minutos", () => {
    const base = 15 * 60_000;
    expect(watchdogSchedulerDelayMs(base, 2)).toBe(30 * 60_000);
    expect(watchdogSchedulerDelayMs(base, 3)).toBe(60 * 60_000);
    expect(watchdogSchedulerDelayMs(base, 4)).toBe(120 * 60_000);
    expect(watchdogSchedulerDelayMs(base, 20)).toBe(120 * 60_000);
  });
});
