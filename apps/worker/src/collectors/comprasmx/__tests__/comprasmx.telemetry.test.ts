import { classifyComprasMxFailure } from "../comprasmx.failure";
import {
  EMPTY_COMPRASMX_TELEMETRY,
  transitionComprasMxTelemetry,
  type ComprasMxTelemetryState,
} from "../comprasmx.telemetry";

const START = new Date("2026-06-09T12:00:00.000Z");
const unauthorized = new Error("ComprasMX API status 401: Unauthorized");

function fail401(
  state: ComprasMxTelemetryState,
  at: Date,
) {
  return transitionComprasMxTelemetry(
    state,
    {
      success: false,
      error: unauthorized,
      diagnosis: classifyComprasMxFailure(unauthorized, {
        siteAccessible: true,
      }),
    },
    at,
  );
}

describe("ComprasMX telemetry and Telegram throttling", () => {
  it("no alerta por cada 401 y alerta amarilla solo al tercero", () => {
    const first = fail401(EMPTY_COMPRASMX_TELEMETRY, START);
    const second = fail401(
      first.state,
      new Date(START.getTime() + 30 * 60 * 1000),
    );
    const third = fail401(
      second.state,
      new Date(START.getTime() + 60 * 60 * 1000),
    );
    const fourth = fail401(
      third.state,
      new Date(START.getTime() + 90 * 60 * 1000),
    );

    expect(first.alertMessage).toBeNull();
    expect(second.alertMessage).toBeNull();
    expect(third.alertMessage).toContain("[DEGRADADO] ComprasMX");
    expect(third.alertMessage).toContain("Fallos consecutivos: 3");
    expect(third.diagnosis?.category).toBe("PERSISTENT_AUTH_401");
    expect(fourth.alertMessage).toBeNull();
  });

  it("manda una sola alerta crítica al superar dos horas sin éxito", () => {
    const first = fail401(EMPTY_COMPRASMX_TELEMETRY, START);
    const second = fail401(
      first.state,
      new Date(START.getTime() + 30 * 60 * 1000),
    );
    const third = fail401(
      second.state,
      new Date(START.getTime() + 60 * 60 * 1000),
    );
    const prolonged = fail401(
      third.state,
      new Date(START.getTime() + 121 * 60 * 1000),
    );
    const repeated = fail401(
      prolonged.state,
      new Date(START.getTime() + 150 * 60 * 1000),
    );

    expect(prolonged.alertMessage).toContain(
      "sin extracción por más de 2 horas",
    );
    expect(repeated.alertMessage).toBeNull();
  });

  it("manda recuperación una sola vez después de un incidente alertado", () => {
    const first = fail401(EMPTY_COMPRASMX_TELEMETRY, START);
    const second = fail401(first.state, new Date(START.getTime() + 1_000));
    const third = fail401(second.state, new Date(START.getTime() + 2_000));

    const recovered = transitionComprasMxTelemetry(
      third.state,
      { success: true },
      new Date(START.getTime() + 3_000),
    );
    const stable = transitionComprasMxTelemetry(
      recovered.state,
      { success: true },
      new Date(START.getTime() + 4_000),
    );

    expect(recovered.alertMessage).toContain(
      "ComprasMX volvió a extraer información correctamente",
    );
    expect(stable.alertMessage).toBeNull();
    expect(recovered.state.comprasmx_consecutive_failures).toBe(0);
  });

  it("no manda alerta verde por un 401 recuperado dentro del mismo ciclo", () => {
    const recovered = transitionComprasMxTelemetry(
      EMPTY_COMPRASMX_TELEMETRY,
      {
        success: true,
        recoveredFromTransient401: true,
        diagnosis: classifyComprasMxFailure(unauthorized, {
          retryAttempted: true,
          retrySucceeded: true,
        }),
      },
      START,
    );

    expect(recovered.alertMessage).toBeNull();
    expect(recovered.state.last_comprasmx_success_at).toBe(START.toISOString());
  });

  it("alerta de inmediato ante un cambio estructural", () => {
    const error = new Error("Botón Buscar no encontrado");
    const transition = transitionComprasMxTelemetry(
      EMPTY_COMPRASMX_TELEMETRY,
      {
        success: false,
        error,
        diagnosis: classifyComprasMxFailure(error, { siteAccessible: true }),
      },
      START,
    );

    expect(transition.alertMessage).toContain(
      "[ERROR TÉCNICO] ComprasMX Scraper",
    );
    expect(transition.diagnosis?.origin).toBe("SITE_CHANGED");
  });
});
