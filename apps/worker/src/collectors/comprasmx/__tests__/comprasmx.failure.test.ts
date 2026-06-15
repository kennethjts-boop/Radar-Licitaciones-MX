import {
  classifyComprasMxFailure,
  withComprasMxCleanSessionRetry,
} from "../comprasmx.failure";

describe("classifyComprasMxFailure", () => {
  it("clasifica 401 con portal accesible como sesión transitoria de ComprasMX", () => {
    const diagnosis = classifyComprasMxFailure(
      new Error("ComprasMX API status 401: Unauthorized"),
      { siteAccessible: true },
    );

    expect(diagnosis).toMatchObject({
      origin: "COMPRASMX",
      category: "TRANSIENT_AUTH_OR_SESSION_401",
      confidence: "MEDIUM",
      severity: "WARN",
      shouldAlertTelegram: false,
    });
  });

  it("clasifica el tercer 401 como persistente y degradado", () => {
    const diagnosis = classifyComprasMxFailure(
      new Error("ComprasMX API status 401: Unauthorized"),
      { siteAccessible: true, consecutiveFailures: 3 },
    );

    expect(diagnosis).toMatchObject({
      origin: "COMPRASMX",
      category: "PERSISTENT_AUTH_401",
      severity: "DEGRADED",
      shouldAlertTelegram: true,
    });
  });

  it("clasifica selectores rotos como cambio estructural", () => {
    const diagnosis = classifyComprasMxFailure(
      new Error("Botón Buscar no encontrado. Selectores probados: [button]"),
      { siteAccessible: true },
    );

    expect(diagnosis).toMatchObject({
      origin: "SITE_CHANGED",
      category: "SCRAPER_OR_SITE_STRUCTURE_CHANGED",
      shouldAlertTelegram: true,
    });
  });

  it("clasifica fallos de red como infraestructura", () => {
    const diagnosis = classifyComprasMxFailure(
      new Error("getaddrinfo ENOTFOUND comprasmx.buengobierno.gob.mx"),
    );

    expect(diagnosis).toMatchObject({
      origin: "NETWORK_INFRA",
      category: "INFRA_OR_BROWSER_FAILURE",
      shouldAlertTelegram: false,
    });
  });

  it("clasifica configuración faltante como error local crítico", () => {
    const diagnosis = classifyComprasMxFailure(
      new Error("No source_id for comprasmx available"),
      { missingConfig: ["source_id"] },
    );

    expect(diagnosis).toMatchObject({
      origin: "OUR_SCRAPER",
      category: "LOCAL_CONFIG_ERROR",
      confidence: "HIGH",
      severity: "CRITICAL",
      shouldAlertTelegram: true,
    });
  });
});

describe("withComprasMxCleanSessionRetry", () => {
  it("recrea sesión una sola vez y recupera un 401 transitorio", async () => {
    const runSession = jest.fn()
      .mockRejectedValueOnce(new Error("ComprasMX API status 401: Unauthorized"))
      .mockResolvedValueOnce({ rows: 12 });

    const result = await withComprasMxCleanSessionRetry(runSession);

    expect(runSession).toHaveBeenNthCalledWith(1, false);
    expect(runSession).toHaveBeenNthCalledWith(2, true);
    expect(runSession).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      value: { rows: 12 },
      retryPerformed: true,
      recoveredFromTransient401: true,
    });
    expect(result.recoveryDiagnosis?.category).toBe("RECOVERED_TRANSIENT_401");
  });

  it("propaga un 401 persistente después de un único reintento", async () => {
    const runSession = jest.fn()
      .mockRejectedValue(new Error("ComprasMX API status 401: Unauthorized"));

    await expect(withComprasMxCleanSessionRetry(runSession)).rejects.toThrow(
      "401",
    );
    expect(runSession).toHaveBeenCalledTimes(2);
  });
});
