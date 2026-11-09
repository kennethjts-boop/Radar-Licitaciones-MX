jest.mock("../../../collectors/comprasmx/browser.manager", () => ({ BrowserManager: { withContext: jest.fn() } }));
import { summarizeEconomicRequirements } from "../budget-resolver";

const payload = (rows: Array<Record<string, unknown>>, paginacion = [{ total_registros: rows.length, total_paginas: 1 }]) =>
  ({ success: true, data: [{ registros: [{ numero_grupo: 1, data_registros: rows }], paginacion }] });

describe("presupuesto desde requerimientos económicos de ComprasMX", () => {
  it("suma el monto máximo de las partidas (caso real BIRMEX N-3-2027)", () => {
    const summary = summarizeEconomicRequirements(payload([
      { descripcion_detallada: "PARTIDA 1. REGIÓN I", monto_minimo: 212130990.72, monto_maximo: 530327476.8 },
      { descripcion_detallada: "PARTIDA 2. REGIÓN II", monto_minimo: 230402577.36, monto_maximo: 576006443.41 },
    ]));
    expect(summary).toMatchObject({ amount: 1106333920.21, partidas: 2 });
    expect(summary?.excerpt).toContain("PARTIDA 1");
  });

  it("sin montos o con lista incompleta no confirma nada", () => {
    expect(summarizeEconomicRequirements(payload([{ descripcion_detallada: "P1", monto_maximo: null }]))).toBeNull();
    expect(summarizeEconomicRequirements(payload([{ monto_maximo: 100 }], [{ total_registros: 5, total_paginas: 2 }]))).toBeNull();
    expect(summarizeEconomicRequirements({})).toBeNull();
  });
});
