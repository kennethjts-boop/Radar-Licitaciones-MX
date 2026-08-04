import {
  verifySnapshotFields,
  buildExpedienteUrl,
  type WatchdogTarget,
} from "../target-resolver";
import type { WatchdogSnapshot } from "../types";

describe("Target Resolver & Verification", () => {
  it("debe construir correctamente la URL del expediente", () => {
    const url = buildExpedienteUrl("abc-123");
    expect(url).toBe(
      "https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/abc-123/procedimiento",
    );
  });

  it("debe validar un snapshot completo con los campos obligatorios del portal", () => {
    const validSnapshot: WatchdogSnapshot = {
      partial: false,
      extractionFailure: null,
      deploymentSha: "sha",
      tableSignatures: [],
      documentSignature: "doc-sig",
      numeroProcedimiento: "LA-09-J0U-009J0U001-N-68-2026",
      expedienteUrl: "https://comprasmx.buengobierno.gob.mx/",
      uuidProcedimiento: "uuid-123",
      detail: {},
      documents: [],
      visibleFields: {
        "Estatus del procedimiento de contratación": "VIGENTE",
        "Número de procedimiento de contratación": "LA-09-J0U-009J0U001-N-68-2026",
      },
      visibleTables: [],
    };

    const verification = verifySnapshotFields(validSnapshot);
    expect(verification.valid).toBe(true);
  });

  it("debe rechazar snapshots parciales o con falta de campos obligatorios", () => {
    const partialSnapshot: WatchdogSnapshot = {
      partial: true,
      extractionFailure: {
        cause: "SITE_STRUCTURE",
        stage: "dom_stability",
        errorType: "Error",
        message: "No cargó el contenedor",
        attempts: 1,
      },
      deploymentSha: "sha",
      tableSignatures: [],
      documentSignature: "doc-sig",
      numeroProcedimiento: "LA-09-J0U-009J0U001-N-68-2026",
      expedienteUrl: "https://comprasmx.buengobierno.gob.mx/",
      uuidProcedimiento: "uuid-123",
      detail: {},
      documents: [],
      visibleFields: {},
      visibleTables: [],
    };

    const verification = verifySnapshotFields(partialSnapshot);
    expect(verification.valid).toBe(false);
    expect(verification.failedSelectors).toBeDefined();
  });
});
