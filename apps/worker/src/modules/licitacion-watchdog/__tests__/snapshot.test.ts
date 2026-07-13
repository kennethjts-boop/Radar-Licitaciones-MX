import { diffSnapshots, hashSnapshot, normalizeSnapshot } from "../snapshot";
import type { WatchdogSnapshot } from "../types";

function snapshot(): WatchdogSnapshot {
  return normalizeSnapshot({
    partial: false,
    numeroProcedimiento: "LA-09-J0U-009J0U001-N-68-2026",
    expedienteUrl: "https://comprasmx.example/detalle/uuid/procedimiento",
    uuidProcedimiento: "uuid",
    detail: { registro: [{ estatus: "EN ACLARACIONES", fecha_apertura: "2026-07-17T10:00:00" }] },
    documents: [{
      id: "doc-1",
      name: "Convocatoria.pdf",
      description: "Convocatoria",
      type: "CONVOCATORIA",
      createdAt: "2026-06-30T23:15:58",
      modifiedAt: "2026-06-30T23:35:34",
      sizeBytes: 100,
      url: "https://example.com/doc-1",
      isActa: false,
    }],
    visibleFields: { "Estatus": "EN ACLARACIONES" },
    visibleTables: [],
  });
}

describe("licitacion-watchdog snapshot diff", () => {
  it("snapshot idéntico no genera alerta", () => {
    const previous = snapshot();
    const current = snapshot();
    expect(hashSnapshot(previous)).toBe(hashSnapshot(current));
    expect(diffSnapshots(previous, current)).toEqual([]);
  });

  it("documento nuevo genera cambio document_added", () => {
    const previous = snapshot();
    const current = snapshot();
    current.documents.push({
      id: "doc-2",
      name: "Acta de fallo.pdf",
      description: "ACTA DE FALLO",
      type: "ACTA",
      createdAt: "2026-07-31T13:00:00.000Z",
      modifiedAt: "2026-07-31T13:00:00.000Z",
      sizeBytes: 200,
      url: "https://example.com/doc-2",
      isActa: true,
    });
    const changes = diffSnapshots(previous, current);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "document_added", document: { name: "Acta de fallo.pdf" } });
  });

  it("cambio de fecha genera alerta campo por campo", () => {
    const previous = snapshot();
    const current = snapshot();
    const detail = current.detail.registro as Array<Record<string, string>>;
    detail[0].fecha_apertura = "2026-07-18T16:00:00.000Z";
    const changes = diffSnapshots(previous, current);
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "modified",
        path: "detail.registro[0].fecha_apertura",
      }),
    ]));
  });
});
