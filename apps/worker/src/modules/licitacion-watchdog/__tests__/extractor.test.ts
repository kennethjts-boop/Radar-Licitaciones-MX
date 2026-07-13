import type { Page } from "playwright";
import { waitForStableVisibleSnapshot } from "../extractor";

function visible(rowCount: number) {
  return {
    fields: { Estatus: "EN ACLARACIONES" },
    tables: [{
      headers: ["Núm.", "Partida específica"],
      rows: Array.from({ length: rowCount }, (_, index) => [String(index + 1), "35301"]),
    }],
  };
}

describe("waitForStableVisibleSnapshot", () => {
  it("continúa polling si la tabla con encabezados aún está vacía y acepta 2 lecturas pobladas", async () => {
    const evaluate = jest.fn()
      .mockResolvedValueOnce(visible(0))
      .mockResolvedValueOnce(visible(0))
      .mockResolvedValueOnce(visible(12))
      .mockResolvedValueOnce(visible(12));
    const page = { evaluate } as unknown as Page;

    const result = await waitForStableVisibleSnapshot(page, { pollIntervalMs: 1, timeoutMs: 10 });

    expect(result.partial).toBe(false);
    expect(result.tables[0].rows).toHaveLength(12);
    expect(evaluate).toHaveBeenCalledTimes(4);
  });

  it("marca partial si vence el timeout con encabezados y cero filas", async () => {
    const evaluate = jest.fn().mockResolvedValue(visible(0));
    const page = { evaluate } as unknown as Page;

    const result = await waitForStableVisibleSnapshot(page, { pollIntervalMs: 1, timeoutMs: 2 });

    expect(result.partial).toBe(true);
    expect(result.tables[0].headers).toHaveLength(2);
    expect(result.tables[0].rows).toHaveLength(0);
    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it("marca partial si las filas siguen cambiando hasta el timeout", async () => {
    const evaluate = jest.fn()
      .mockResolvedValueOnce(visible(1))
      .mockResolvedValueOnce(visible(2))
      .mockResolvedValueOnce(visible(3));
    const page = { evaluate } as unknown as Page;

    const result = await waitForStableVisibleSnapshot(page, { pollIntervalMs: 1, timeoutMs: 2 });

    expect(result.partial).toBe(true);
    expect(result.tables[0].rows).toHaveLength(3);
  });
});
