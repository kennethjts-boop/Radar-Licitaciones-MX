import {
  detectProcedureCompletion,
  formatCompletionMessage,
  readProcedureStatus,
} from "../completion";
import type { WatchdogSnapshot } from "../types";

function buildSnapshot(status: string | null): WatchdogSnapshot {
  return {
    partial: false,
    extractionFailure: null,
    deploymentSha: null,
    tableSignatures: [],
    documentSignature: "sig",
    numeroProcedimiento: "LA-50-GYR-050GYR007-N-173-2026",
    expedienteUrl: "https://comprasmx.buengobierno.gob.mx/sitiopublico/",
    uuidProcedimiento: "uuid",
    detail: {},
    documents: [],
    visibleFields:
      status === null
        ? {}
        : { "Estatus del procedimiento de contratación": status },
    visibleTables: [],
  } as unknown as WatchdogSnapshot;
}

describe("detección de expedientes concluidos", () => {
  it("detecta un procedimiento desierto", () => {
    const completion = detectProcedureCompletion(buildSnapshot("DESIERTA"));
    expect(completion).toEqual({ status: "DESIERTA", kind: "desierta" });
  });

  it("detecta un procedimiento cancelado o anulado", () => {
    expect(detectProcedureCompletion(buildSnapshot("CANCELADA"))?.kind).toBe("cancelada");
    expect(detectProcedureCompletion(buildSnapshot("PROCEDIMIENTO ANULADO"))?.kind).toBe("anulada");
  });

  it("normaliza acentos y mayúsculas", () => {
    const completion = detectProcedureCompletion(buildSnapshot("Procedimiento Desierto"));
    expect(completion?.kind).toBe("desierta");
    expect(completion?.status).toBe("PROCEDIMIENTO DESIERTO");
  });

  it("no retira la vigilancia tras un fallo o una adjudicación", () => {
    // Después del fallo se publican el contrato y sus anexos: seguir vigilando
    // es justamente lo que detecta oportunidades adicionales.
    expect(detectProcedureCompletion(buildSnapshot("ADJUDICADO"))).toBeNull();
    expect(detectProcedureCompletion(buildSnapshot("FALLO"))).toBeNull();
    expect(detectProcedureCompletion(buildSnapshot("EN FIRMA"))).toBeNull();
    expect(detectProcedureCompletion(buildSnapshot("CONTRATO FIRMADO"))).toBeNull();
  });

  it("no decide nada cuando el portal no expone el estatus", () => {
    expect(readProcedureStatus(buildSnapshot(null))).toBeNull();
    expect(detectProcedureCompletion(buildSnapshot(null))).toBeNull();
  });

  it("no decide nada con un estatus vacío", () => {
    expect(detectProcedureCompletion(buildSnapshot("   "))).toBeNull();
  });
});

describe("mensaje de finalización del watchdog", () => {
  it("identifica el expediente, el estatus y el motivo", () => {
    const message = formatCompletionMessage(
      "IMSS · Laboratorios",
      "LA-50-GYR-050GYR007-N-173-2026",
      { status: "DESIERTA", kind: "desierta" },
      "https://comprasmx.buengobierno.gob.mx/sitiopublico/detalle/uuid/procedimiento",
    );
    expect(message).toContain("Watchdog finalizado");
    expect(message).toContain("LA-50-GYR-050GYR007-N-173-2026");
    expect(message).toContain("DESIERTA");
    expect(message).toContain("desiert");
    expect(message).toContain("ya no se vigilará");
  });

  it("escapa el texto remoto del portal y el alias", () => {
    const message = formatCompletionMessage(
      "IMSS <b>inyectado</b>",
      "PROC-1",
      { status: "<script>alert(1)</script>", kind: "cancelada" },
      "https://comprasmx.buengobierno.gob.mx/",
    );
    expect(message).not.toContain("<script>");
    expect(message).not.toContain("<b>inyectado</b>");
    expect(message).toContain("&lt;script&gt;");
  });
});
