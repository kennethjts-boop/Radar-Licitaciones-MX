import { reconcilePriorityOpportunities } from "../reconcile";
import type { ResolvedBudget } from "../budget-resolver";

type Row = Record<string, unknown>;
let procurements: Row[] = [];
let alertedKeys: string[] = [];
const ensurePending = jest.fn();
const upsertMatch = jest.fn();

jest.mock("../../../storage/client", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      const chain: Record<string, jest.Mock> = {};
      chain.select = jest.fn(() => chain);
      chain.in = jest.fn(() =>
        table === "radars"
          ? Promise.resolve({ data: ["birmex_prioridad_20261108", "edomex_difem_20261108", "edomex_jcem_20261108", "edomex_salud_20261108"]
              .map((key) => ({ id: `id-${key}`, key, is_active: true })), error: null })
          : Promise.resolve({ data: alertedKeys.map((dedupe_key) => ({ dedupe_key })), error: null }));
      chain.or = jest.fn(() => chain);
      chain.order = jest.fn(() => chain);
      chain.limit = jest.fn(() => Promise.resolve({ data: procurements, error: null }));
      return chain;
    },
  }),
}));
jest.mock("../../../storage/match-alert.repo", () => ({
  ensurePendingNewTenderAlert: (...args: unknown[]) => ensurePending(...args),
  upsertMatch: (...args: unknown[]) => upsertMatch(...args),
}));
jest.mock("../../../enrichers/match.enricher", () => ({ enrichMatch: async (_i: unknown, m: unknown) => ({ ...(m as object), telegramMessage: "x" }) }));
jest.mock("../../../jobs/collect.job", () => ({
  dbRowToNormalized: (row: Row) => ({
    source: "comprasmx", sourceUrl: row.source_url, externalId: row.id, expedienteId: null, licitationNumber: row.licitation_number,
    procedureNumber: null, title: row.title, description: null, dependencyName: row.dependency_name, buyingUnit: null,
    status: row.status, publicationDate: null, openingDate: row.opening_date, amount: row.amount, attachments: [], canonicalText: "",
    rawJson: {},
  }),
}));

const row = (over: Row): Row => ({
  id: "p1", source_url: "https://comprasmx.buengobierno.gob.mx/x", licitation_number: "LA-12-NEF-012NEF001-N-1-2027",
  title: "ADQUISICIÓN CONSOLIDADA DE MEDICAMENTOS", dependency_name: "BIRMEX", status: "activa", opening_date: "2099-01-01",
  amount: null, procedure_number: null, expediente_id: null, sources: { key: "comprasmx" }, ...over,
});
const budget = (amount: number): ResolvedBudget => ({
  amount, currency: "MXN", page: 7, label: "presupuesto máximo autorizado", excerpt: "…", documentUrl: "https://x/bases.pdf", documentName: "bases.pdf",
  sourceKind: "detalle_bases_anexo",
});

describe("conciliación de focos de prioridad", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    alertedKeys = [];
    ensurePending.mockResolvedValue({ alertId: "a1", created: true, status: "pending" });
  });

  it("compra consolidada cuyo monto se publica después: queda por verificar y luego alerta con el monto del documento", async () => {
    procurements = [row({})];
    const first = await reconcilePriorityOpportunities({ resolveBudget: async () => null });
    expect(first).toMatchObject({ toVerify: 1, queued: 0, budgetLookups: 1, budgetsResolved: 0 });
    expect(ensurePending).not.toHaveBeenCalled();

    procurements = [row({})];
    const second = await reconcilePriorityOpportunities({ resolveBudget: async () => budget(180_000_000) });
    expect(second).toMatchObject({ budgetsResolved: 1, queued: 1, toVerify: 0 });
    expect(ensurePending).toHaveBeenCalledTimes(1);
  });

  it("monto confirmado bajo el umbral no alerta", async () => {
    procurements = [row({})];
    const result = await reconcilePriorityOpportunities({ resolveBudget: async () => budget(99_000_000) });
    expect(result).toMatchObject({ budgetsResolved: 1, queued: 0, matched: 0 });
    expect(ensurePending).not.toHaveBeenCalled();
  });

  it("licitación cancelada con fecha futura no alerta ni consulta documentos", async () => {
    procurements = [row({ status: "cancelada", opening_date: "2099-01-01", amount: 500_000_000 })];
    const resolveBudget = jest.fn();
    const result = await reconcilePriorityOpportunities({ resolveBudget });
    expect(result).toMatchObject({ closedOrExpired: 1, queued: 0, budgetLookups: 0 });
    expect(ensurePending).not.toHaveBeenCalled();
    expect(resolveBudget).not.toHaveBeenCalled();
  });

  it("reproceso: una sola alerta por expediente", async () => {
    procurements = [row({ amount: 250_000_000 })];
    const first = await reconcilePriorityOpportunities();
    expect(first.queued).toBe(1);
    alertedKeys = ["new_match:p1"];
    const again = await reconcilePriorityOpportunities();
    expect(again).toMatchObject({ queued: 0, alreadyAlerted: 1 });
    expect(ensurePending).toHaveBeenCalledTimes(1);
  });

  it("BIRMEX sale primero y el tope por corrida se respeta", async () => {
    procurements = [
      row({ id: "j1", dependency_name: "Junta de Caminos del Estado de México (JCEM)", amount: 300_000_000, licitation_number: "J-1" }),
      row({ id: "b1", amount: 120_000_000 }),
    ];
    const result = await reconcilePriorityOpportunities({ maxQueue: 1 });
    expect(result.queued).toBe(1);
    expect(ensurePending.mock.calls[0][1]).toBe("b1");
    expect(result.candidates.find((c) => c.outcome === "cap_reached")?.radarKey).toBe("edomex_jcem_20261108");
  });
});

describe("BIRMEX sin monto en el listado ni palabras de gran alcance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    alertedKeys = [];
    ensurePending.mockResolvedValue({ alertId: "a1", created: true, status: "pending" });
  });
  const looked: string[] = [];
  const guard = {
    shouldLookup: async (id: string) => !looked.includes(id),
    record: async (id: string) => { looked.push(id); },
  };

  it("se consulta el presupuesto publicado en el portal y alerta si cumple el umbral", async () => {
    looked.length = 0;
    procurements = [row({ id: "b2", title: "SERVICIO DE FUMIGACIÓN Y CONTROL DE FAUNA", licitation_number: "LA-12-NEF-012NEF001-N-9-2027" })];
    const resolveBudget = jest.fn(async () => budget(150_000_000));
    const result = await reconcilePriorityOpportunities({ resolveBudget, budgetLookupGuard: guard });
    expect(resolveBudget).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ budgetsResolved: 1, queued: 1 });
  });

  it("no relee el portal del mismo expediente en cada ciclo", async () => {
    looked.length = 0;
    procurements = [row({ id: "b3", title: "SERVICIO DE LIMPIEZA", licitation_number: "LA-12-NEF-012NEF001-N-10-2027" })];
    const resolveBudget = jest.fn(async () => null);
    await reconcilePriorityOpportunities({ resolveBudget, budgetLookupGuard: guard });
    await reconcilePriorityOpportunities({ resolveBudget, budgetLookupGuard: guard });
    expect(resolveBudget).toHaveBeenCalledTimes(1);
  });

  it("un BIRMEX cerrado no se consulta", async () => {
    looked.length = 0;
    procurements = [row({ id: "b4", title: "SERVICIO DE LIMPIEZA", status: "cancelada" })];
    const resolveBudget = jest.fn(async () => budget(150_000_000));
    await reconcilePriorityOpportunities({ resolveBudget, budgetLookupGuard: guard });
    expect(resolveBudget).not.toHaveBeenCalled();
  });
});
