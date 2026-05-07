import { extractBudgetSignals } from "../budget-signal-extractor";

describe("extractBudgetSignals", () => {
  it("detecta monto con símbolo $", () => {
    const r = extractBudgetSignals("El presupuesto es de $1,234,567.89 para la obra.");
    expect(r.hasSignals).toBe(true);
    expect(r.highestAmount).toBeCloseTo(1234567.89, 1);
    expect(r.signals[0].confidence).toBe("alta");
  });

  it("detecta millones en texto", () => {
    const r = extractBudgetSignals("monto estimado de 2.5 millones de pesos");
    expect(r.hasSignals).toBe(true);
    expect(r.highestAmount).toBeCloseTo(2500000, 0);
  });

  it("detecta MXN seguido de monto", () => {
    const r = extractBudgetSignals("valor MXN 850,000.00");
    expect(r.hasSignals).toBe(true);
    expect(r.highestAmount).toBeCloseTo(850000, 0);
  });

  it("highestAmount es el mayor de múltiples señales", () => {
    const r = extractBudgetSignals("techo $500,000.00 y monto máximo $1,200,000.00");
    expect(r.highestAmount).toBeCloseTo(1200000, 0);
  });

  it("confianza baja para monto sin contexto presupuestal", () => {
    const r = extractBudgetSignals("factura por $45,000.00 pagada el lunes");
    expect(r.hasSignals).toBe(true);
    expect(r.signals[0].confidence).toBe("baja");
  });

  it("sin señales en texto sin montos", () => {
    const r = extractBudgetSignals("Licitación de servicios de limpieza sin monto definido.");
    expect(r.hasSignals).toBe(false);
    expect(r.highestAmount).toBeNull();
    expect(r.signals).toHaveLength(0);
  });

  it("no hace throw con texto vacío", () => {
    expect(() => extractBudgetSignals("")).not.toThrow();
    const r = extractBudgetSignals("");
    expect(r.hasSignals).toBe(false);
  });
});
