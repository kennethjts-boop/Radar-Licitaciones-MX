import { formatChangeMessages } from "../telegram";
import type {
  NotificationState,
  WatchdogChange,
  WatchdogSnapshotRow,
} from "../types";

const headers = [
  "Núm.",
  "Partida específica",
  "Clave CUCoP+",
  "Descripción CUCoP+",
  "Descripción detallada",
  "Unidad de medida",
];

function partida(number: number, detail: string): string[] {
  return [
    String(number),
    "35301",
    "35301-0001",
    "MANTENIMIENTO DE EQUIPO INFORMÁTICO",
    detail,
    "SERVICIO",
  ];
}

function snapshotRow(
  notificationKind: NotificationState["kind"],
  rows: string[][],
  changes: WatchdogChange[],
): WatchdogSnapshotRow {
  return {
    id: "snapshot-1",
    numero_procedimiento: "LA-09-J0U-009J0U001-N-68-2026",
    snapshot_hash: "hash",
    snapshot_json: {
      partial: false,
      extractionFailure: null,
      deploymentSha: "962840fed1f23cf7c00fe12487cd01030f28e926",
      tableSignatures: [],
      documentSignature: "document-signature",
      numeroProcedimiento: "LA-09-J0U-009J0U001-N-68-2026",
      expedienteUrl: "https://comprasmx.example/detalle/uuid/procedimiento",
      uuidProcedimiento: "uuid",
      detail: {},
      documents: [],
      visibleFields: {},
      visibleTables: [{ headers, rows }],
    },
    detected_changes: {
      changes,
      notification: { kind: notificationKind, status: "pending" },
    },
    created_at: "2026-07-13T11:28:41.000Z",
  };
}

describe("formatChangeMessages", () => {
  it("agrupa el baseline completado y presenta partidas legibles", () => {
    const rows = Array.from({ length: 12 }, (_, index) => partida(
      index + 1,
      index === 2
        ? "SERVICIO DE MANTENIMIENTO PREVENTIVO DE LA RED FONADIN Y TRAMO MÉXICO - PUEBLA. PARTIDA 3"
        : "SERVICIO DE MANTENIMIENTO PREVENTIVO Y CORRECTIVO DE LA RED CAPUFE",
    ));
    const changes: WatchdogChange[] = rows.map((current, index) => ({
      kind: "added",
      path: `visibleTables[0].rows[${index}]`,
      previous: undefined,
      current,
    }));

    const message = formatChangeMessages(snapshotRow("baseline_completed", rows, changes)).join("\n");

    expect(message).toContain("[BASELINE_COMPLETADO]");
    expect(message).toContain("Tabla de partidas poblada: 12 partidas detectadas");
    expect(message).toContain("Partida 3 (NUEVA FILA) — CUCOP 35301 — FONADIN + México-Puebla — Solo preventivo");
    expect(message).not.toContain('["3","35301"');
  });

  it.each([
    ["MODIFICADA", { kind: "modified", path: "visibleTables[0].rows[0][4]", previous: "ANTERIOR", current: "NUEVO" }],
    ["ELIMINADA", { kind: "removed", path: "visibleTables[0].rows[0]", previous: partida(1, "MANTENIMIENTO PREVENTIVO RED CAPUFE"), current: undefined }],
  ] as const)("distingue fila %s", (classification, change) => {
    const rows = classification === "ELIMINADA"
      ? []
      : [partida(1, "MANTENIMIENTO PREVENTIVO Y CORRECTIVO RED CAPUFE")];
    const message = formatChangeMessages(snapshotRow("change", rows, [change])).join("\n");

    expect(message).toContain(`(${classification})`);
  });
});
