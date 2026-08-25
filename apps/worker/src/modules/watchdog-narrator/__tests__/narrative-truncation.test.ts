import type { WatchdogChange } from "../../licitacion-watchdog/types";

jest.mock("../ai-narrator", () => ({
  generateAiNarrativeSections: jest.fn(async () => ({
    queSignifica: "Cambió algo en el expediente.",
    queDeboHacer: ["Revisar el expediente.", "Validar requerimientos."],
  })),
}));

import { formatWatchdogNarrative } from "../index";

function unknownChanges(total: number): WatchdogChange[] {
  return Array.from({ length: total }, (_, i) => ({
    kind: "modified" as const,
    path: `custom.campo_raro_${i}`,
    previous: `valor-previo-${i}`,
    current: `valor-nuevo-${i}`,
  }));
}

describe("formatWatchdogNarrative - Detalle técnico acotado", () => {
  it("debe limitar el detalle técnico a 20 líneas e indicar el total", async () => {
    const result = await formatWatchdogNarrative({
      alias: "LA-09-J0U-009J0U001-N-68-2026",
      expedienteUrl: "https://comprasmx.buengobierno.gob.mx/sitiopublico/",
      changes: unknownChanges(400),
    });

    expect(result.category).toBe("desconocido");
    expect(result.text).toContain("Detalle técnico (primeros 20 de 400):");
    const detalle = result.text.split("Detalle técnico (primeros 20 de 400):\n")[1];
    expect(detalle.split("\n").length).toBe(20);
    expect(result.text).not.toContain("campo_raro_20:");
  });

  it("no debe anotar truncado cuando hay pocos cambios", async () => {
    const result = await formatWatchdogNarrative({
      alias: "LA-09-J0U-009J0U001-N-68-2026",
      expedienteUrl: "https://comprasmx.buengobierno.gob.mx/sitiopublico/",
      changes: unknownChanges(3),
    });

    expect(result.text).toContain("Detalle técnico:");
    expect(result.text).not.toContain("primeros 20 de");
  });
});
