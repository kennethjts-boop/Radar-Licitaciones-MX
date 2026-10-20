import { getPendingNewTenderAlerts } from "../match-alert.repo";

const query = {
  select: jest.fn(),
  eq: jest.fn(),
  not: jest.fn(),
  gte: jest.fn(),
  order: jest.fn(),
  limit: jest.fn(),
};
jest.mock("../client", () => ({
  getSupabaseClient: () => ({ from: () => query }),
}));

function mockRows(rows: unknown[]) {
  query.limit.mockResolvedValue({ data: rows, error: null });
}

describe("cola de nuevas convocatorias de octubre", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.not.mockReturnValue(query);
    query.gte.mockReturnValue(query);
    query.order.mockReturnValue(query);
    mockRows([
      {
        id: "alert-1",
        telegram_message: "Convocatoria nueva",
        procurements: { publication_date: "2026-10-15" },
      },
    ]);
  });

  it("sólo entrega alertas pendientes de radares activos", async () => {
    expect(await getPendingNewTenderAlerts()).toEqual([
      { id: "alert-1", telegramMessage: "Convocatoria nueva" },
    ]);
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining("radars!inner(is_active)"));
    expect(query.eq).toHaveBeenCalledWith("radars.is_active", true);
    expect(query.eq).toHaveBeenCalledWith("telegram_status", "pending");
  });

  it("no filtra por fecha en la consulta para no ocultar alertas con fecha ausente", async () => {
    await getPendingNewTenderAlerts();
    // El corte se evalúa en memoria: un `publication_date` NULL (el listado de
    // ComprasMX no lo expone) dejaba la alerta huérfana en la base, invisible
    // para la cola y sin ningún reintento posterior.
    expect(query.gte).not.toHaveBeenCalledWith(
      "procurements.publication_date",
      expect.anything(),
    );
  });

  it("conserva una alerta cuyo expediente no tiene fecha de publicación", async () => {
    mockRows([
      {
        id: "alert-2",
        telegram_message: "Convocatoria sin fecha verificable",
        procurements: { publication_date: null },
      },
    ]);
    expect(await getPendingNewTenderAlerts()).toEqual([
      { id: "alert-2", telegramMessage: "Convocatoria sin fecha verificable" },
    ]);
  });

  it("excluye una alerta publicada antes del corte operativo", async () => {
    mockRows([
      {
        id: "alert-3",
        telegram_message: "Convocatoria anterior al corte",
        procurements: { publication_date: "2026-10-13" },
      },
    ]);
    expect(await getPendingNewTenderAlerts()).toEqual([]);
  });
});
