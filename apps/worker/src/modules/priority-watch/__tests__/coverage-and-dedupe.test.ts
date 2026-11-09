jest.mock("../../../core/logger", () => ({ createModuleLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));
jest.mock("../../../storage/client", () => ({ getSupabaseClient: jest.fn() }));

import { priorityWatchCoversChange, calendarCoversWatchdogChange } from "../../procurement-calendar/supersede";
import { analyzeStructuralLoss, StructuralChangeGuard } from "../../licitacion-watchdog/structural-guard";
import { nextPartidasCoverage } from "../../licitacion-watchdog/partidas-coverage";
import { trackingOrigin } from "../../procurement-calendar/service";
import { emptyState, type WatchState } from "../store";
import { watchKeyboard } from "../format";
import type { WatchdogChange, WatchdogSnapshot, WatchdogSnapshotRow } from "../../licitacion-watchdog/types";
import { W3, capture3, snap } from "./helpers";

const NOW = "2026-11-09T05:00:00.000Z";
const stateWith = (lastSuccessAt: string | null, mutate?: (s: WatchState) => void): WatchState => {
  const state = { ...emptyState(), baseline: snap(W3, capture3()), lastSuccessAt };
  mutate?.(state);
  return state;
};
const apertura = (current: string): WatchdogChange => ({
  kind: "modified", path: "visibleFields.Fecha y hora de presentación y apertura de proposiciones", previous: "19/11/2026 10:00", current,
});
const row = (changes: WatchdogChange[], numero = W3.procedure): WatchdogSnapshotRow => ({
  id: "s1", numero_procedimiento: numero, snapshot_hash: "h", snapshot_json: {} as never,
  detected_changes: { changes, notification: { kind: "change", status: "pending" } }, created_at: "2026-11-09T04:50:00.000Z",
});

describe("deduplicación por folio y evento (criterio 2)", () => {
  it("cubre solo si la captura de ESE folio es posterior al cambio y ya contiene ese mismo valor", () => {
    const state = stateWith("2026-11-09T04:55:00.000Z");
    // el estado confirmado trae apertura 19/11/2026 10:00: el mismo valor está cubierto
    expect(priorityWatchCoversChange(state, row([]).created_at, apertura("19/11/2026 10:00"))).toBe(true);
    expect(priorityWatchCoversChange(state, row([]).created_at, apertura("2026-11-19T16:00:00.000Z"))).toBe(true);
    // otro valor (el watchdog vio un cambio que la vigilancia aún no confirmó): NO se suprime
    expect(priorityWatchCoversChange(state, row([]).created_at, apertura("26/11/2026 10:00"))).toBe(false);
  });

  it("Edomex termina bien pero el portal falla para el folio: la captura es anterior al cambio, el watchdog SÍ avisa", async () => {
    const edomexOk = { at: NOW, calendar: { tracked: 1 } }; // el ciclo general corrió bien hace segundos
    expect(edomexOk.calendar.tracked).toBe(1);
    const stale = stateWith("2026-11-09T03:00:00.000Z"); // última captura exitosa de este folio, antes del cambio
    const store = { load: async () => stale, save: async () => undefined };
    expect(await calendarCoversWatchdogChange(row([apertura("19/11/2026 10:00")]), undefined, Date.parse(NOW), store)).toBe(false);
    const fresh = stateWith("2026-11-09T04:55:00.000Z");
    expect(await calendarCoversWatchdogChange(row([apertura("19/11/2026 10:00")]), undefined, Date.parse(NOW), { load: async () => fresh, save: async () => undefined })).toBe(true);
    expect(await calendarCoversWatchdogChange(row([apertura("19/11/2026 10:00")]), undefined, Date.parse(NOW), { load: async () => emptyState(), save: async () => undefined })).toBe(false);
  });

  it("documentos: se cede solo si el documento ya está en el estado confirmado; las partidas solo con cobertura ok", () => {
    const doc: WatchdogChange = { kind: "document_added", path: "documents[x]", previous: undefined, current: "x", document: { name: "CONVOCATORIA.pdf" } as never };
    const state = stateWith("2026-11-09T04:55:00.000Z");
    expect(priorityWatchCoversChange(state, row([]).created_at, doc)).toBe(true); // «CONVOCATORIA» ya consta
    const unknown = { ...doc, document: { name: "ACTA_FA_nueva.pdf" } as never };
    expect(priorityWatchCoversChange(state, row([]).created_at, unknown)).toBe(false);
    const table: WatchdogChange = { kind: "modified", path: "visibleTables[0].rows", previous: 1, current: 2 };
    expect(priorityWatchCoversChange(state, row([]).created_at, table)).toBe(false);
    const description: WatchdogChange = { ...table, path: "visibleTables[0].rows[3][2]", current: state.baseline!.partidas[3].descripcion };
    expect(priorityWatchCoversChange(state, row([]).created_at, description)).toBe(true);
    expect(priorityWatchCoversChange(state, row([]).created_at, { ...description, current: "PARTIDA 4. NUEVO ALCANCE" })).toBe(false);
    const degraded = stateWith("2026-11-09T04:55:00.000Z", (s) => { s.partidasCoverage = { status: "degraded", since: NOW, consecutive: 3, reason: "x" }; });
    expect(priorityWatchCoversChange(degraded, row([]).created_at, table)).toBe(false);
  });

  it("no cede revisiones de un documento solo por compartir nombre ni estatus parciales distintos", () => {
    const state = stateWith("2026-11-09T04:55:00.000Z");
    const modified: WatchdogChange = { kind: "modified", path: "documents.x.modifiedAt", previous: NOW, current: "2026-11-10T00:00:00", document: { name: "CONVOCATORIA.pdf" } as never };
    expect(priorityWatchCoversChange(state, row([]).created_at, modified)).toBe(false);
    state.baseline!.portalStatus = "ADJUDICADO";
    expect(priorityWatchCoversChange(state, row([]).created_at, { kind: "modified", path: "detail.estatus", previous: "ADJUDICADO", current: "ADJUDICADO PARCIAL" })).toBe(false);
  });
});

describe("structural_incomplete de N-3-2027 reproducido con un fixture (criterio 1)", () => {
  const table = (rows: string[][]) => ({ headers: ["Núm.", "Partida", "Descripción"], rows });
  const filled = Array.from({ length: 7 }, (_, i) => [String(i + 1), "33901", `PARTIDA ${i + 1}. REGIÓN`]);
  const snapshot = (rows: string[][], partial = false) => ({ visibleTables: [table(rows)], documents: [], partial, visibleFields: {} } as unknown as WatchdogSnapshot);

  it("la tabla con la fila de relleno «sin resultados» tras 7 filas confirmadas se rechaza como incompleta", () => {
    const previous = snapshot(filled);
    const placeholder = snapshot([["No hay resultados"]]);
    const analysis = analyzeStructuralLoss(previous, placeholder);
    expect(analysis.reasons.join(" ")).toMatch(/\(7 filas previas\)/);
    const decision = new StructuralChangeGuard().evaluate(W3.procedure, previous, placeholder);
    expect(decision.action).not.toBe("accept");
  });

  it("la cobertura de partidas pasa de transitoria a DEGRADADA si persiste y vuelve a ok con una captura completa", () => {
    const reasons = ["tabla sin resultados transitoria (7 filas previas)"];
    let s = nextPartidasCoverage(null, reasons, "2026-11-09T04:00:00Z");
    expect(s).toMatchObject({ status: "transient", consecutive: 1, since: "2026-11-09T04:00:00Z" });
    s = nextPartidasCoverage(s, reasons, "2026-11-09T04:15:00Z");
    s = nextPartidasCoverage(s, reasons, "2026-11-09T04:30:00Z");
    expect(s).toMatchObject({ status: "degraded", consecutive: 3, since: "2026-11-09T04:00:00Z", lastReasons: reasons });
    expect(nextPartidasCoverage(s, null, "2026-11-09T04:45:00Z")).toMatchObject({ status: "ok", consecutive: 0, since: null });
  });
});

describe("seguimiento existente y cierre del calendario (criterio 3)", () => {
  it("el registro del ciclo de las 22:00 (sin usuario ni chat) es estado heredado, no evidencia de un botón", () => {
    expect(trackingOrigin(null)).toBe("none");
    expect(trackingOrigin({ enabled: true, lastFailureAt: null, consecutiveFailures: 0 })).toBe("legacy");
    expect(trackingOrigin({ enabled: true, chatId: "1165516608", by: 1165516608 })).toBe("user");
  });

  it("los botones de la vigilancia prioritaria: calendario y enlace; el seguimiento de estos folios no se silencia", () => {
    const keyboard = watchKeyboard("cf2458a7-d351-4f07-be07-84ac1da0764e", "https://comprasmx.buengobierno.gob.mx/x");
    expect(keyboard.inline_keyboard[0].map((b) => b.text)).toEqual(["📅 Ver calendario", "🔗 Abrir expediente"]);
    expect(keyboard.inline_keyboard[0][0].callback_data).toBe("cal:cf2458a7-d351-4f07-be07-84ac1da0764e");
    expect(JSON.stringify(keyboard)).not.toContain("trk:");
  });
});
