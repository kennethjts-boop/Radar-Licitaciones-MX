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

describe("classifyComprasMxFailure — browser closed / timeout", () => {
  // Los errores Playwright de browser cerrado NO deben clasificarse como LOCAL_CONFIG_ERROR
  // aunque el mensaje incluya flags de Chrome con la palabra "config".

  it("NO clasifica como LOCAL_CONFIG_ERROR el error Playwright de browser cerrado por timeout", () => {
    // El mensaje de Playwright incluye los flags de Chrome (--disable-field-trial-config)
    // que contienen la palabra "config". El clasificador NO debe hacer match en esa palabra.
    const playwrightError = new Error(
      [
        "browserType.launch: Target page, context or browser has been closed",
        "Browser logs:",
        "<launching> /ms-playwright/chromium-1140/chrome-linux/chrome",
        "--disable-field-trial-config --disable-background-networking",
        "--disable-background-timer-throttling",
      ].join("\n"),
    );

    const diagnosis = classifyComprasMxFailure(playwrightError, { phase: "collector" });

    expect(diagnosis.category).not.toBe("LOCAL_CONFIG_ERROR");
    expect(diagnosis.category).toBe("BROWSER_CLOSED_AFTER_TIMEOUT");
    expect(diagnosis.severity).not.toBe("CRITICAL");
    expect(diagnosis.shouldAlertTelegram).toBe(false);
  });

  it("clasifica 'Target page, context or browser has been closed' como BROWSER_CLOSED_AFTER_TIMEOUT", () => {
    const diagnosis = classifyComprasMxFailure(
      new Error("Target page, context or browser has been closed"),
    );

    expect(diagnosis.category).toBe("BROWSER_CLOSED_AFTER_TIMEOUT");
    expect(diagnosis.origin).toBe("NETWORK_INFRA");
    expect(diagnosis.shouldAlertTelegram).toBe(false);
  });

  it("clasifica 'Browser operation timed out' como INFRA (no como configuración)", () => {
    const diagnosis = classifyComprasMxFailure(
      new Error("Browser operation timed out after 300000ms"),
      { phase: "collector" },
    );

    expect(diagnosis.category).not.toBe("LOCAL_CONFIG_ERROR");
    expect(diagnosis.category).toBe("INFRA_OR_BROWSER_FAILURE");
    expect(diagnosis.shouldAlertTelegram).toBe(false);
  });

  it("el technicalReason de un error browser-closed tampoco activa LOCAL_CONFIG_ERROR", () => {
    // El technicalReason es la cadena que se reutiliza en transitionComprasMxTelemetry.
    // Debe clasificarse igual aunque venga como string (no Error).
    const technicalReason =
      "phase=collector; error=browserType.launch: Target page, context or browser has been closed\nBrowser logs:\n<launching> /ms-playwright/chrome --disable-field-trial-config";

    const diagnosis = classifyComprasMxFailure(technicalReason);

    expect(diagnosis.category).not.toBe("LOCAL_CONFIG_ERROR");
    expect(diagnosis.category).toBe("BROWSER_CLOSED_AFTER_TIMEOUT");
  });

  it("sí clasifica como LOCAL_CONFIG_ERROR cuando falta source_id real", () => {
    const diagnosis = classifyComprasMxFailure(
      new Error("No source_id for comprasmx available. Cannot collect."),
      { phase: "collect_job_bootstrap", missingConfig: ["comprasmx source_id"] },
    );

    expect(diagnosis.category).toBe("LOCAL_CONFIG_ERROR");
    expect(diagnosis.severity).toBe("CRITICAL");
    expect(diagnosis.shouldAlertTelegram).toBe(true);
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
