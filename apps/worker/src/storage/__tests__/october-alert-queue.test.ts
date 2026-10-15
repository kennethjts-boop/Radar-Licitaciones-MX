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

describe("cola de nuevas convocatorias de octubre", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.not.mockReturnValue(query);
    query.gte.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockResolvedValue({
      data: [{ id: "alert-1", telegram_message: "Convocatoria nueva" }],
      error: null,
    });
  });

  it("sólo entrega alertas pendientes de radares activos publicadas desde el corte", async () => {
    expect(await getPendingNewTenderAlerts()).toEqual([
      { id: "alert-1", telegramMessage: "Convocatoria nueva" },
    ]);
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining("radars!inner(is_active)"));
    expect(query.gte).toHaveBeenCalledWith("procurements.publication_date", "2026-10-14");
    expect(query.eq).toHaveBeenCalledWith("radars.is_active", true);
    expect(query.eq).toHaveBeenCalledWith("telegram_status", "pending");
  });
});
