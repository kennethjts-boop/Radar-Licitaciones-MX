import type { Page } from "playwright";
import { BrowserManager } from "../../../collectors/comprasmx/browser.manager";
import {
  preflightResilientWait,
  waitForResponseResilient,
} from "../../resilience/resilient-wait";
import {
  classifyWatchdogFailure,
  extractWatchdogSnapshot,
  navigateWatchdogPage,
  watchdogErrorMessage,
  waitForStableVisibleSnapshot,
} from "../extractor";
import {
  FastTimeoutError,
  FastWaitAbortedError,
  UpstreamError,
} from "../../resilience/fast-wait";

jest.mock("../../../collectors/comprasmx/browser.manager", () => ({
  BrowserManager: { withContext: jest.fn() },
}));
jest.mock("../../resilience/resilient-wait", () => ({
  preflightResilientWait: jest.fn().mockReturnValue(null),
  waitForResponseResilient: jest.fn(),
}));

const mockedWithContext = jest.mocked(BrowserManager.withContext);
const mockedPreflight = jest.mocked(preflightResilientWait);
const mockedResilientWait = jest.mocked(waitForResponseResilient);

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
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPreflight.mockReturnValue(null);
  });

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

  it("clasifica los errores tipados de resiliencia como NETWORK_INFRA", () => {
    expect(classifyWatchdogFailure(new FastTimeoutError(25_000)))
      .toBe("NETWORK_INFRA");
    expect(classifyWatchdogFailure(
      new UpstreamError(
        503,
        "https://comprasmx.example/whitney/sitiopublico/expedientes/uuid",
      ),
    )).toBe("NETWORK_INFRA");
    expect(classifyWatchdogFailure(new FastWaitAbortedError()))
      .toBe("NETWORK_INFRA");
  });

  it("conserva el status HTTP estructurado de UpstreamError en el mensaje de alerta", () => {
    const error = new UpstreamError(
      503,
      "https://comprasmx.example/whitney/sitiopublico/expedientes/uuid",
    );

    expect(watchdogErrorMessage(error)).toContain("HTTP 503");
    expect(watchdogErrorMessage(error)).toContain(error.url);
  });

  it("propaga UpstreamError 503 como fallo NETWORK_INFRA de api_responses", async () => {
    const error = new UpstreamError(
      503,
      "https://comprasmx.example/whitney/sitiopublico/expedientes/uuid",
    );
    mockedResilientWait.mockRejectedValue(error);
    const page = {
      goto: jest.fn().mockResolvedValue(null),
      waitForSelector: jest.fn().mockResolvedValue({}),
    } as unknown as Page;
    mockedWithContext.mockImplementation(async (operation) =>
      operation(page, {} as never)
    );

    const result = await extractWatchdogSnapshot({
      numeroProcedimiento: "PROC-503",
      expedienteUrl: "https://comprasmx.example/#/detalle/uuid/procedimiento",
      uuidProcedimiento: "uuid",
    });

    expect(result).toEqual(expect.objectContaining({
      partial: true,
      extractionFailure: expect.objectContaining({
        cause: "NETWORK_INFRA",
        stage: "api_responses",
        errorType: "UpstreamError",
        message: expect.stringContaining("HTTP 503"),
      }),
    }));
  });

  it("clasifica DomStabilityError como SITE_STRUCTURE por tipo", () => {
    const error = new Error("Las tablas no se estabilizaron");
    error.name = "DomStabilityError";

    expect(classifyWatchdogFailure(error)).toBe("SITE_STRUCTURE");
  });

  it("clasifica errores HTTP: 4xx como SITE_STRUCTURE y 5xx/408/429 como NETWORK_INFRA", () => {
    expect(classifyWatchdogFailure(new Error("anexos ComprasMX página 2: HTTP 401")))
      .toBe("SITE_STRUCTURE");
    expect(classifyWatchdogFailure(new Error("anexos ComprasMX página 2: HTTP 403")))
      .toBe("SITE_STRUCTURE");
    expect(classifyWatchdogFailure(new Error("anexos ComprasMX página 3: HTTP 503")))
      .toBe("NETWORK_INFRA");
    expect(classifyWatchdogFailure(new Error("detalle ComprasMX: HTTP 429")))
      .toBe("NETWORK_INFRA");
  });

  it("clasifica rechazos de auth del sitio como SITE_STRUCTURE, nunca UNKNOWN", () => {
    expect(classifyWatchdogFailure(new Error("detalle ComprasMX: Unauthorized"))).toBe("SITE_STRUCTURE");
    expect(classifyWatchdogFailure(new Error("Acceso no permitido."))).toBe("SITE_STRUCTURE");
    expect(classifyWatchdogFailure(new Error("anexos ComprasMX página 2: respuesta sin data")))
      .toBe("SITE_STRUCTURE");
  });

  it("clasifica errores imprevistos como APPLICATION_ERROR, nunca UNKNOWN", () => {
    expect(classifyWatchdogFailure(new TypeError("fallo inesperado"))).toBe("APPLICATION_ERROR");
  });

  it("cierra y liquida los waiters si la sesión falla antes de hidratar datos", async () => {
    mockedResilientWait.mockImplementation((_page, _endpoint, _matcher, options) =>
      new Promise<never>((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new Error("Espera cancelada")),
          { once: true },
        );
      }));
    const page = {
      goto: jest.fn().mockRejectedValue(new Error("Target page, context or browser has been closed")),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as Page;
    mockedWithContext.mockImplementation(async (operation) => operation(page, {} as never));

    const result = await extractWatchdogSnapshot({
      numeroProcedimiento: "PROC-1",
      expedienteUrl: "https://comprasmx.example/#/detalle/uuid/procedimiento",
      uuidProcedimiento: "uuid",
    });

    expect(result).toEqual(expect.objectContaining({
      partial: true,
      extractionFailure: expect.objectContaining({
        cause: "NETWORK_INFRA",
        stage: "navigation",
        errorType: "Error",
        attempts: 1,
      }),
    }));
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(mockedResilientWait).toHaveBeenCalledTimes(2);
    expect(mockedResilientWait).toHaveBeenNthCalledWith(
      1,
      page,
      "/whitney/sitiopublico/expedientes/uuid",
      expect.any(Function),
      expect.objectContaining({ timeoutMs: 45_000 }),
    );
    expect(mockedResilientWait).toHaveBeenNthCalledWith(
      2,
      page,
      "/whitney/sitiopublico/expedientes/uuid/anexos",
      expect.any(Function),
      expect.objectContaining({ timeoutMs: 45_000 }),
    );
    expect(mockedWithContext).toHaveBeenCalledWith(
      expect.any(Function),
      { timeoutMs: 180_000 },
    );
  });

  it("propaga skipped antes de abrir un contexto o golpear la red", async () => {
    mockedPreflight.mockReturnValueOnce({
      status: "skipped",
      reason: "circuit_open",
      key: "/whitney/sitiopublico/expedientes/:uuid",
      msUntilRetry: 90_000,
    });

    const result = await extractWatchdogSnapshot({
      numeroProcedimiento: "PROC-1",
      expedienteUrl: "https://comprasmx.example/#/detalle/uuid/procedimiento",
      uuidProcedimiento: "uuid",
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "circuit_open",
      endpointKey: "/whitney/sitiopublico/expedientes/:uuid",
      msUntilRetry: 90_000,
    });
    expect(mockedWithContext).not.toHaveBeenCalled();
    expect(mockedResilientWait).not.toHaveBeenCalled();
  });
});
