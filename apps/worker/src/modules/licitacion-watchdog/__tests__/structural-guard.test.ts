import { StructuralChangeGuard } from "../structural-guard";
import type { WatchdogDocument, WatchdogSnapshot } from "../types";

const PARTIDA_HEADERS = ["Núm.", "Partida específica", "Descripción"];

function documents(count: number): WatchdogDocument[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `doc-${index + 1}`,
    name: `Documento ${index + 1}.pdf`,
    description: null,
    type: "ANEXO",
    createdAt: null,
    modifiedAt: null,
    sizeBytes: 100,
    url: `https://example.com/doc-${index + 1}`,
    isActa: false,
  }));
}

function baseline(): WatchdogSnapshot {
  return {
    partial: false,
    deploymentSha: "sha-baseline",
    tableSignatures: [],
    documentSignature: "documents-30",
    numeroProcedimiento: "LA-09-J0U-009J0U001-N-68-2026",
    expedienteUrl: "https://comprasmx.example/detalle/uuid/procedimiento",
    uuidProcedimiento: "uuid",
    detail: { status: "PUBLICADO" },
    documents: documents(30),
    visibleFields: { Estatus: "PUBLICADO" },
    visibleTables: [
      { headers: ["Dato"], rows: [["estable-1"]] },
      { headers: ["Dato"], rows: [["estable-2"]] },
      { headers: ["Documento"], rows: Array.from({ length: 7 }, (_, index) => [`anexo-${index + 1}`]) },
      {
        headers: PARTIDA_HEADERS,
        rows: Array.from({ length: 12 }, (_, index) => [String(index + 1), "35301", `Partida ${index + 1}`]),
      },
    ],
  };
}

function clone(snapshot: WatchdogSnapshot): WatchdogSnapshot {
  return structuredClone(snapshot);
}

describe("StructuralChangeGuard", () => {
  it("rechaza el snapshot antiguo sin partial y sin las 12 partidas", () => {
    const guard = new StructuralChangeGuard();
    const previous = baseline();
    const oldSnapshot = clone(previous);
    delete (oldSnapshot as unknown as Record<string, unknown>).partial;
    oldSnapshot.visibleTables[3].rows = [];

    const decision = guard.evaluate(previous.numeroProcedimiento, previous, oldSnapshot as WatchdogSnapshot);

    expect(decision.action).toBe("reject_incomplete");
    expect(decision.analysis.reasons).toContain("tabla vacía (12 filas previas)");
  });

  it("retiene una tabla de partidas completamente ausente aunque las demás permanezcan estables", () => {
    const guard = new StructuralChangeGuard();
    const previous = baseline();
    const current = clone(previous);
    current.visibleTables.splice(3, 1);

    const decision = guard.evaluate(previous.numeroProcedimiento, previous, current);

    expect(decision.action).toBe("await_confirmation");
    expect(decision.analysis.reasons).toContain("tabla ausente (12 filas previas)");
  });

  it("no acepta una desaparición masiva en una sola captura completa", () => {
    const guard = new StructuralChangeGuard();
    const previous = baseline();
    const current = clone(previous);
    current.visibleTables[3].rows = current.visibleTables[3].rows.slice(0, 4);
    current.documents = current.documents.slice(0, 10);

    const decision = guard.evaluate(previous.numeroProcedimiento, previous, current);

    expect(decision.action).toBe("await_confirmation");
    expect(decision.analysis.reasons).toEqual(expect.arrayContaining([
      "pérdida significativa de filas (12→4)",
      "pérdida significativa de documentos (30→10)",
    ]));
  });

  it("confirma la eliminación masiva solo tras dos capturas completas con la misma firma", () => {
    const guard = new StructuralChangeGuard();
    const previous = baseline();
    const current = clone(previous);
    current.visibleTables[3].rows = current.visibleTables[3].rows.slice(0, 4);
    current.documents = current.documents.slice(0, 10);

    const first = guard.evaluate(previous.numeroProcedimiento, previous, current);
    const second = guard.evaluate(previous.numeroProcedimiento, previous, clone(current));

    expect(first.action).toBe("await_confirmation");
    expect(second.action).toBe("confirmed");
    if (first.action === "await_confirmation" && second.action === "confirmed") {
      expect(second.analysis.signature).toBe(first.analysis.signature);
      expect(second.captures).toBe(2);
    }
  });

  it("reinicia la confirmación si la segunda captura tiene contenido distinto", () => {
    const guard = new StructuralChangeGuard();
    const previous = baseline();
    const firstCurrent = clone(previous);
    firstCurrent.visibleTables[3].rows = firstCurrent.visibleTables[3].rows.slice(0, 4);
    const secondCurrent = clone(previous);
    secondCurrent.visibleTables[3].rows = secondCurrent.visibleTables[3].rows.slice(0, 3);

    expect(guard.evaluate(previous.numeroProcedimiento, previous, firstCurrent).action)
      .toBe("await_confirmation");
    expect(guard.evaluate(previous.numeroProcedimiento, previous, secondCurrent).action)
      .toBe("await_confirmation");
  });
});
