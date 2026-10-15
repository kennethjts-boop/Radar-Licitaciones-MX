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

describe("formatWatchdogNarrative - avisos operativos breves", () => {
  it("resume un cambio de apertura, con enlace y acción sin llamar a IA", async () => {
    const result = await formatWatchdogNarrative({
      alias: "IMSS · Banco de sangre",
      expedienteUrl: "https://comprasmx.example/detalle/test?x=1&y=2",
      changes: [
        { kind: "modified", path: "detail.fecha_apertura", previous: "2026-10-23", current: "2026-10-28" },
        { kind: "modified", path: "detail.other", previous: "A", current: "B" },
      ],
    });
    expect(result.category).toBe("fecha_apertura");
    expect(result.text).toContain("⏰ <b>GOSS · CAMBIÓ LA APERTURA</b>");
    expect(result.text).toContain("2026-10-28");
    expect(result.text).toContain("✅ <b>Revisar:</b>");
    expect(result.text).toContain("2 cambios detectados");
    expect(result.text).toContain('href="https://comprasmx.example/detalle/test?x=1&amp;y=2"');
    expect(result.text).not.toContain("¿QUÉ SIGNIFICA?");
    expect(result.text.length).toBeLessThan(800);
  });

  it("escapa HTML de campos del expediente sin romper formato Telegram", async () => {
    const result = await formatWatchdogNarrative({
      alias: "IMSS <nuevo>",
      expedienteUrl: "https://comprasmx.example/",
      changes: [{ kind: "modified", path: "estatus", previous: "VIGENTE", current: "EN FALLO <aviso>" }],
    });
    expect(result.text).toContain("IMSS &lt;nuevo&gt;");
    expect(result.text).toContain("&lt;aviso&gt;");
    expect(result.text).not.toContain("<aviso>");
  });
});

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
