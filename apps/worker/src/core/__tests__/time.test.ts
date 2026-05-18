import { formatDateSafe, formatMexicoDate, mexicoDateAtHourISO } from "../time";

describe("formatDateSafe", () => {
  it("null → 'No disponible'", () => {
    expect(formatDateSafe(null)).toBe("No disponible");
  });

  it("undefined → 'No disponible'", () => {
    expect(formatDateSafe(undefined)).toBe("No disponible");
  });

  it("string vacío → 'No disponible'", () => {
    expect(formatDateSafe("")).toBe("No disponible");
  });

  it("string inválido → 'No disponible'", () => {
    expect(formatDateSafe("invalid string")).toBe("No disponible");
  });

  it("nunca retorna 'Fecha inválida'", () => {
    expect(formatDateSafe("garbage-date")).not.toContain("Fecha inválida");
    expect(formatDateSafe("NaN")).not.toContain("NaN");
  });

  it("YYYY-MM-DD (solo fecha) → dd/MM/yyyy sin hora", () => {
    expect(formatDateSafe("2026-06-01")).toBe("01/06/2026");
  });

  it("YYYY-MM-DDTHH:mm:ss (ISO datetime) → dd/MM/yyyy — HH:mm h CDMX", () => {
    expect(formatDateSafe("2026-06-01T04:00:00")).toBe("01/06/2026 — 04:00 h CDMX");
  });

  it("dd/MM/yyyy HH:mm → dd/MM/yyyy — HH:mm h CDMX", () => {
    expect(formatDateSafe("01/06/2026 04:00")).toBe("01/06/2026 — 04:00 h CDMX");
  });
});

describe("formatMexicoDate", () => {
  it("acepta timestamps numéricos guardados en system_state", () => {
    expect(formatMexicoDate(1779108960000)).toBe("18/05/2026 06:56");
  });

  it("acepta timestamps numéricos como string", () => {
    expect(formatMexicoDate("1779108960000")).toBe("18/05/2026 06:56");
  });
});

describe("mexicoDateAtHourISO", () => {
  it("convierte hora local MX a ISO UTC para el resumen diario", () => {
    expect(mexicoDateAtHourISO("2026-05-18", 7)).toBe("2026-05-18T13:00:00.000Z");
  });
});
