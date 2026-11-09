import { refreshBirmexFromSource } from "../source-refresh";

const upsert = jest.fn();
jest.mock("../../../storage/client", () => ({
  getSupabaseClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "src" }, error: null }) }) }) }) }),
}));
jest.mock("../../../storage/procurement.repo", () => ({ upsertProcurement: (...a: unknown[]) => upsert(...a) }));

const registro = (numero: string) => ({
  numero_procedimiento: numero, nombre_procedimiento: "SERVICIO INTEGRADO", siglas: "BIRMEX", estatus: "VIGENTE SIN ACTA",
  estatus_alterno: "VIGENTE", fecha_apertura: "2026-11-19T10:00:00", uuid_procedimiento: "u1", unidad_compradora: "012NEF001",
});

describe("cruce directo de BIRMEX", () => {
  beforeEach(() => { jest.clearAllMocks(); upsert.mockResolvedValue({ isNew: false, procurementId: "p" }); });

  it("actualiza por el camino normal y reporta cobertura completa", async () => {
    const search = jest.fn().mockResolvedValue({ registros: [registro("LA-12-NEF-012NEF001-N-3-2027")], total: 1, pagesScanned: 1 });
    const result = await refreshBirmexFromSource({ search });
    expect(result).toMatchObject({ coverage: "complete", read: 1, updated: 1, created: 0 });
    expect(upsert.mock.calls[0][0]).toMatchObject({ licitationNumber: "LA-12-NEF-012NEF001-N-3-2027", openingDate: "2026-11-19T10:00:00" });
  });

  it("cobertura parcial si el portal reporta más de lo leído o si falla", async () => {
    const more = jest.fn().mockResolvedValue({ registros: [registro("A")], total: 3, pagesScanned: 1 });
    expect((await refreshBirmexFromSource({ search: more })).coverage).toBe("partial");
    const fail = jest.fn().mockRejectedValue(new Error("401"));
    expect(await refreshBirmexFromSource({ search: fail })).toMatchObject({ coverage: "partial", error: "401" });
  });
});
