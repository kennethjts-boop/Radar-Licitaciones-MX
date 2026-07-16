import type { Page } from "playwright";
import { BrowserManager } from "../../../collectors/comprasmx/browser.manager";
import {
  classifyWatchdogFailure,
  extractWatchdogSnapshot,
  navigateWatchdogPage,
  waitForStableVisibleSnapshot,
} from "../extractor";

jest.mock("../../../collectors/comprasmx/browser.manager", () => ({
  BrowserManager: { withContext: jest.fn() },
}));

const mockedWithContext = jest.mocked(BrowserManager.withContext);

function visible(rowCount: number) {
  return {
    fields: { Estatus: "EN ACLARACIONES" },
    tables: [{
      headers: ["Núm.", "Partida específica"],
      rows: Array.from({ length: rowCount }, (_, index) => [String(index + 1), "35301"]),
    }],
  };
}

describe("waitForStableVisibleSnapshot", () => {
  it("continúa polling si la tabla con encabezados aún está vacía y acepta 2 lecturas pobladas", async () => {
    const evaluate = jest.fn()
      .mockResolvedValueOnce(visible(0))
      .mockResolvedValueOnce(visible(0))
      .mockResolvedValueOnce(visible(12))
      .mockResolvedValueOnce(visible(12));
    const page = { evaluate } as unknown as Page;

    const result = await waitForStableVisibleSnapshot(page, { pollIntervalMs: 1, timeoutMs: 10 });

    expect(result.partial).toBe(false);
    expect(result.tables[0].rows).toHaveLength(12);
    expect(evaluate).toHaveBeenCalledTimes(4);
  });

  it("marca partial si vence el timeout con encabezados y cero filas", async () => {
    const evaluate = jest.fn().mockResolvedValue(visible(0));
    const page = { evaluate } as unknown as Page;

    const result = await waitForStableVisibleSnapshot(page, { pollIntervalMs: 1, timeoutMs: 2 });

    expect(result.partial).toBe(true);
    expect(result.tables[0].headers).toHaveLength(2);
    expect(result.tables[0].rows).toHaveLength(0);
    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it("marca partial si las filas siguen cambiando hasta el timeout", async () => {
    const evaluate = jest.fn()
      .mockResolvedValueOnce(visible(1))
      .mockResolvedValueOnce(visible(2))
      .mockResolvedValueOnce(visible(3));
    const page = { evaluate } as unknown as Page;

    const result = await waitForStableVisibleSnapshot(page, { pollIntervalMs: 1, timeoutMs: 2 });

    expect(result.partial).toBe(true);
    expect(result.tables[0].rows).toHaveLength(3);
  });

  it("exige estabilidad del contenido completo aunque el conteo no cambie", async () => {
    const first = visible(1);
    const changed = visible(1);
    changed.tables[0].rows[0][1] = "35302";
    const evaluate = jest.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(changed)
      .mockResolvedValueOnce(changed);
    const page = { evaluate } as unknown as Page;

    const result = await waitForStableVisibleSnapshot(page, { pollIntervalMs: 1, timeoutMs: 5 });

    expect(result.partial).toBe(false);
    expect(result.tables[0].rows[0][1]).toBe("35302");
    expect(evaluate).toHaveBeenCalledTimes(3);
  });
});

describe("navegación watchdog resiliente", () => {
  it("usa commit, espera 5s y reintenta una sola vez ante ERR_ABORTED", async () => {
    const goto = jest.fn()
      .mockRejectedValueOnce(new Error("page.goto: net::ERR_ABORTED"))
      .mockResolvedValueOnce(null);
    const wait = jest.fn().mockResolvedValue(undefined);

    const result = await navigateWatchdogPage(
      { goto } as unknown as Page,
      "https://comprasmx.example/#/detalle",
      wait,
    );

    expect(result).toEqual({ ok: true, attempts: 2, error: null });
    expect(wait).toHaveBeenCalledWith(5_000);
    expect(goto).toHaveBeenCalledTimes(2);
    expect(goto).toHaveBeenNthCalledWith(1, "https://comprasmx.example/#/detalle", {
      waitUntil: "commit",
      timeout: 45_000,
    });
  });

  it("no reintenta errores no clasificados como navegación transitoria", async () => {
    const error = new Error("Protocol error inesperado");
    const goto = jest.fn().mockRejectedValue(error);
    const wait = jest.fn().mockResolvedValue(undefined);

    const result = await navigateWatchdogPage(
      { goto } as unknown as Page,
      "https://comprasmx.example/#/detalle",
      wait,
    );

    expect(result).toEqual({ ok: false, attempts: 1, error });
    expect(wait).not.toHaveBeenCalled();
    expect(goto).toHaveBeenCalledTimes(1);
  });

  it("clasifica fallos de zygote y browser cerrado como NETWORK_INFRA", () => {
    expect(classifyWatchdogFailure(new Error("Failed to launch zygote process"))).toBe("NETWORK_INFRA");
    expect(classifyWatchdogFailure(new Error("Target page, context or browser has been closed")))
      .toBe("NETWORK_INFRA");
  });

  it("cierra y liquida los waiters si la sesión falla antes de hidratar datos", async () => {
    const rejectWaiters: Array<(reason: Error) => void> = [];
    const waitForResponse = jest.fn(() => new Promise<never>((_resolve, reject) => {
      rejectWaiters.push(reject);
    }));
    const page = {
      waitForResponse,
      goto: jest.fn().mockRejectedValue(new Error("Target page, context or browser has been closed")),
      close: jest.fn().mockImplementation(async () => {
        for (const reject of rejectWaiters) reject(new Error("Page closed"));
      }),
    } as unknown as Page;
    mockedWithContext.mockImplementation(async (operation) => operation(page, {} as never));

    const result = await extractWatchdogSnapshot({
      numeroProcedimiento: "PROC-1",
      expedienteUrl: "https://comprasmx.example/#/detalle/uuid/procedimiento",
      uuidProcedimiento: "uuid",
    });

    expect(result.partial).toBe(true);
    expect(result.extractionFailure).toEqual(expect.objectContaining({
      cause: "NETWORK_INFRA",
      stage: "navigation",
      attempts: 1,
    }));
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(waitForResponse).toHaveBeenCalledTimes(2);
  });
});
