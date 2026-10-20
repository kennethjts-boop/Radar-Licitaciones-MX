import { upsertProcurement } from "../procurement.repo";

const updateMock = jest.fn();
const selectMaybeSingleMock = jest.fn();
const selectCountMock = jest.fn();

/** Constructor de consulta encadenable mínimo (supabase-js flavor). */
function makeQuery() {
  const builder: Record<string, unknown> = {};
  builder.select = jest.fn(() => {
    builder.maybeSingle = selectMaybeSingleMock;
    builder.single = jest.fn(async () => ({ data: {}, error: null }));
    builder.eq = jest.fn(() => builder);
    return builder;
  });
  builder.eq = jest.fn(() => builder);
  builder.maybeSingle = selectMaybeSingleMock;
  builder.insert = jest.fn(() => builder);
  builder.update = updateMock;
  builder.single = jest.fn(async () => ({ data: {}, error: null }));
  return builder;
}

const query = makeQuery();

const client = {
  from: jest.fn(() => query),
};

jest.mock("../client", () => ({
  getSupabaseClient: () => client,
}));

function buildNormalized(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "ext-1",
    source: "comprasmx",
    sourceUrl: "https://comprasmx.buengobierno.gob.mx/sitiopublico/detalle/abc/procedimiento",
    title: "Licitación de prueba",
    description: "Descripción",
    dependencyName: "IMSS",
    buyingUnit: "IMSS",
    procedureType: "Licitación",
    status: "VIGENTE",
    publicationDate: null,
    openingDate: "2026-11-01T09:00:00",
    awardDate: null,
    state: "Morelos",
    municipality: "Cuernavaca",
    amount: 1000,
    currency: "MXN",
    procedureNumber: "PROC-1",
    licitationNumber: "LIC-1",
    expedienteId: "exp-1",
    canonicalText: "canonical",
    canonicalFingerprint: "fingerprint-nuevo",
    lightweightFingerprint: "light-nuevo",
    canonicalHash: "hash",
    rawJson: {},
    attachments: [],
    fetchedAt: new Date().toISOString(),
    ...overrides,
  } as never;
}

describe("conservación de la fecha de publicación verificada", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    selectMaybeSingleMock.mockResolvedValue({
      data: {
        id: "proc-1",
        source_id: "comprasmx",
        external_id: "ext-1",
        title: "Licitación de prueba",
        description: "Descripción",
        dependency_name: "IMSS",
        buying_unit: "IMSS",
        status: "VIGENTE",
        publication_date: "2026-10-15",
        opening_date: "2026-11-01T09:00:00",
        amount: 1000,
        licitation_number: "LIC-1",
        source_url: "https://comprasmx.buengobierno.gob.mx/sitiopublico/detalle/abc/procedimiento",
        canonical_fingerprint: "fingerprint-anterior",
      },
      error: null,
    });
    selectCountMock.mockResolvedValue({ count: 1, error: null });
    updateMock.mockReturnValue({ eq: async () => ({ error: null }) });
  });

  it("no vacía la fecha de publicación cuando el listado no la trae", async () => {
    const result = await upsertProcurement(buildNormalized({ publicationDate: null }), "comprasmx");

    expect(result.isUpdated).toBe(true);
    const updatePayload = updateMock.mock.calls[0][0];
    expect(updatePayload.publication_date).toBe("2026-10-15");
  });

  it("sí actualiza la fecha cuando el listado trae una fecha distinta", async () => {
    await upsertProcurement(buildNormalized({ publicationDate: "2026-10-20" }), "comprasmx");

    const updatePayload = updateMock.mock.calls[0][0];
    expect(updatePayload.publication_date).toBe("2026-10-20");
  });
});
