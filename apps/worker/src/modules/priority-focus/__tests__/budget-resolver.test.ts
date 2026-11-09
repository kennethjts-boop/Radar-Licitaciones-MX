jest.mock("../../../collectors/comprasmx/browser.manager", () => ({ BrowserManager: { withContext: jest.fn() } }));
import { summarizeEconomicRequirements, type DetailRecord } from "../budget-resolver";

type Row = { descripcion_detallada?: string; monto_minimo?: number | null; monto_maximo?: number | null };
const part = (n: number, max: number | null, min: number | null = 1): Row =>
  ({ descripcion_detallada: `PARTIDA ${n}. REGIÓN ${n}`, monto_minimo: min, monto_maximo: max });
const payload = (rows: Row[], opts: { grupo?: string; total?: number; paginas?: number } = {}) => ({
  success: true,
  data: [{
    registros: [{ numero_grupo: 1, grupo: opts.grupo ?? "PARTIDA SOLA", data_registros: rows }],
    paginacion: [{ total_registros: opts.total ?? rows.length, total_paginas: opts.paginas ?? 1 }],
  }],
});
const detail = (over: Partial<DetailRecord> = {}, count = 7): DetailRecord => ({
  descripcion_moneda: "PESO MEXICANO", contrato_abierto: 1, tipo_contrato_abierto: "Monto",
  req_economicos: Array.from({ length: count }, () => ({})), ...over,
});
const seven = [530327476.8, 576006443.41, 415719975.26, 952831894.75, 755727746.31, 660840570.37, 1369367285]
  .map((m, i) => part(i + 1, m));

describe("presupuesto desde requerimientos económicos de ComprasMX", () => {
  it("caso real BIRMEX N-3-2027: 7 partidas, peso mexicano, completas y acumulables", () => {
    const summary = summarizeEconomicRequirements(payload(seven), detail());
    expect(summary).toMatchObject({ amount: 5260821391.9, partidas: 7, currency: "MXN" });
    expect(summary?.excerpt).toContain("peso mexicano");
    expect(summary?.excerpt).toContain("IVA: no consta");
  });

  it("moneda distinta de peso mexicano o ausente: sigue por verificar", () => {
    expect(summarizeEconomicRequirements(payload(seven), detail({ descripcion_moneda: "DÓLAR AMERICANO" }))).toBeNull();
    expect(summarizeEconomicRequirements(payload(seven), detail({ descripcion_moneda: null }))).toBeNull();
    expect(summarizeEconomicRequirements(payload(seven), null)).toBeNull();
  });

  it("lista incompleta: paginación, conteo del detalle, huecos de numeración o partidas sin monto", () => {
    expect(summarizeEconomicRequirements(payload(seven, { total: 9 }), detail())).toBeNull();
    expect(summarizeEconomicRequirements(payload(seven, { paginas: 2 }), detail())).toBeNull();
    expect(summarizeEconomicRequirements(payload(seven), detail({}, 8))).toBeNull();
    expect(summarizeEconomicRequirements(payload([...seven.slice(0, 2), ...seven.slice(3)]), detail({}, 6))).toBeNull();
    expect(summarizeEconomicRequirements(payload([...seven.slice(0, 6), part(7, null)]), detail())).toBeNull();
    expect(summarizeEconomicRequirements(payload([part(1, 100, 500)]), detail({}, 1))).toBeNull(); // mínimo > máximo
  });

  it("partidas no independientes (grupo distinto de PARTIDA SOLA) no se suman", () => {
    expect(summarizeEconomicRequirements(payload(seven, { grupo: "GRUPO 1 - ADJUDICACIÓN CONJUNTA" }), detail())).toBeNull();
  });
});
