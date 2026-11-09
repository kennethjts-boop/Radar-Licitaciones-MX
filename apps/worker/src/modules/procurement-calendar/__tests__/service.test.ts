import fixture from "./fixtures/birmex-n3-2027.detail.json";
import type { CalendarSnapshot } from "../types";

// Almacén en memoria en lugar de system_state.
const mem = {
  snapshots: new Map<string, CalendarSnapshot>(), tracking: new Map<string, Record<string, unknown>>(),
  notified: new Map<string, Record<string, string>>(), buttons: new Map<string, Record<string, unknown>>(),
};
jest.mock("../store", () => ({
  getSnapshot: async (id: string) => mem.snapshots.get(id) ?? null,
  saveSnapshot: async (s: CalendarSnapshot) => { mem.snapshots.set(s.procurementId, s); },
  getTracking: async (id: string) => mem.tracking.get(id) ?? null,
  saveTracking: async (id: string, v: Record<string, unknown>) => { mem.tracking.set(id, v); },
  getButtons: async (id: string) => mem.buttons.get(id) ?? null,
  saveButtons: async (id: string, v: Record<string, unknown>) => { mem.buttons.set(id, v); },
  getNotifiedKeys: async (id: string) => new Set(Object.keys(mem.notified.get(id) ?? {})),
  addNotifiedKeys: async (id: string, keys: string[]) => {
    const cur = mem.notified.get(id) ?? {}; keys.forEach((k) => { cur[k] = "now"; }); mem.notified.set(id, cur);
  },
  listTrackedProcurementIds: async () => [...mem.tracking.entries()].filter(([, v]) => v.enabled === true).map(([k]) => k),
}));
jest.mock("../fetch", () => ({ fetchComprasMxDetailData: jest.fn() }));
jest.mock("../../../storage/client", () => ({ getSupabaseClient: jest.fn() }));

import { disableTracking, enableTracking, getCalendarView, runCalendarTracking, type CalendarDeps, type ProcurementInfo } from "../service";

const ID = "cf2458a7-d351-4f07-be07-84ac1da0764e";
const URL = "https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/8d0517be786f4f878c109c5d861226ce/procedimiento";
const info: ProcurementInfo = {
  id: ID, expediente: "LA-12-NEF-012NEF001-N-77-2027", title: "SERVICIO INTEGRADO REGIONAL", buyer: "BIRMEX", sourceKey: "comprasmx",
  sourceUrl: URL, status: "activa", openingDate: "2026-11-19", publicationDate: null, createdAt: "2026-11-09T02:48:19.686Z", rawJson: {},
};

let portal: unknown = fixture;
let portalDown = false;
const sent: string[] = [];
const watchdog: string[] = [];
const deps: CalendarDeps = {
  loadProcurement: async () => info,
  fetchDetail: async () => { if (portalDown) throw new Error("401"); return JSON.parse(JSON.stringify(portal)); },
  send: async (text) => { sent.push(text); },
  watchdogEnable: async (id) => { watchdog.push(`on:${id}`); },
  watchdogDisable: async (id) => { watchdog.push(`off:${id}`); },
  implicitTrackedIds: async () => [],
  now: () => "2026-11-09T03:10:00.000Z",
};
const withFecha = (field: string, value: string | null) => {
  const data = JSON.parse(JSON.stringify(fixture));
  data.registro[0][field] = value;
  return data;
};

describe("seguimiento del calendario", () => {
  beforeEach(() => {
    Object.values(mem).forEach((m) => m.clear());
    sent.length = 0; watchdog.length = 0; portalDown = false; portal = fixture;
  });

  it("Ver calendario muestra la apertura oficial del 19 de noviembre", async () => {
    const view = await getCalendarView(ID, deps);
    expect(view?.text).toContain("Presentación y apertura de proposiciones:</b> 19/11/2026 10:00");
    expect(view?.stale).toBe(false);
  });

  it("fecha pendiente: un solo aviso al publicarse y el siguiente ciclo no lo repite", async () => {
    portal = withFecha("fecha_acto_fallo", null);
    await enableTracking(ID, "123", 1, deps);
    expect(watchdog).toEqual([`on:${ID}`]); // reutiliza el watchdog
    expect(await runCalendarTracking(deps)).toMatchObject({ tracked: 1, unchanged: 1, notified: 0 });

    portal = fixture; // el fallo se publica: 24/11/2026 18:00
    const published = await runCalendarTracking(deps);
    expect(published).toMatchObject({ notified: 1, changes: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Sin publicar → <b>24/11/2026 18:00</b>");

    const next = await runCalendarTracking(deps); // ciclo siguiente
    expect(next).toMatchObject({ notified: 0, changes: 0, unchanged: 1 });
    expect(sent).toHaveLength(1);
  });

  it("fecha modificada: anterior, nueva y enlace; una sola vez por modificación", async () => {
    await enableTracking(ID, "123", 1, deps);
    portal = withFecha("fecha_apertura", "2026-11-26T10:00:00");
    await runCalendarTracking(deps);
    await runCalendarTracking(deps);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("19/11/2026 10:00 → <b>26/11/2026 10:00</b>");
    expect(sent[0]).toContain(URL);
    portal = withFecha("fecha_apertura", "2026-12-03T10:00:00"); // otra modificación = otro aviso
    await runCalendarTracking(deps);
    expect(sent).toHaveLength(2);
  });

  it("si el portal falla conserva el último calendario confirmado y no avisa", async () => {
    await enableTracking(ID, "123", 1, deps);
    portalDown = true;
    const run = await runCalendarTracking(deps);
    expect(run).toMatchObject({ portalFailures: 1, notified: 0 });
    expect(mem.snapshots.get(ID)?.milestones.presentacion_apertura.at).toBe("2026-11-19T10:00:00");
    expect(mem.tracking.get(ID)).toMatchObject({ enabled: true, consecutiveFailures: 1 });
    const view = await getCalendarView(ID, deps);
    expect(view?.stale).toBe(true);
    expect(view?.text).toContain("19/11/2026 10:00");
    expect(view?.text).toContain("El portal no respondió; se muestra el último calendario confirmado");
  });

  it("consultar el calendario no adelanta la línea base de un expediente con seguimiento", async () => {
    await enableTracking(ID, "123", 1, deps);
    portal = withFecha("fecha_apertura", "2026-11-26T10:00:00");
    await getCalendarView(ID, deps);
    expect(mem.snapshots.get(ID)?.milestones.presentacion_apertura.at).toBe("2026-11-19T10:00:00");
    await runCalendarTracking(deps);
    expect(sent).toHaveLength(1);
  });

  it("Dejar de avisar desactiva el seguimiento y el watchdog; no se envían más avisos", async () => {
    await enableTracking(ID, "123", 1, deps);
    await disableTracking(ID, deps);
    expect(watchdog).toEqual([`on:${ID}`, `off:${ID}`]);
    portal = withFecha("fecha_apertura", "2026-11-26T10:00:00");
    expect((await runCalendarTracking(deps)).tracked).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("seguimiento ya autorizado en el watchdog (BIRMEX): toma línea base y luego avisa", async () => {
    const implicit = { ...deps, implicitTrackedIds: async () => [ID] };
    expect(await runCalendarTracking(implicit)).toMatchObject({ baselines: 1, notified: 0 });
    portal = withFecha("fecha_apertura", "2026-11-26T10:00:00");
    expect(await runCalendarTracking(implicit)).toMatchObject({ notified: 1 });
  });
});

describe("seguimiento implícito (autorizado en el watchdog)", () => {
  beforeEach(() => { Object.values(mem).forEach((m) => m.clear()); sent.length = 0; portalDown = false; portal = fixture; });

  it("el ciclo no crea un registro de seguimiento propio, ni en éxito ni en falla del portal", async () => {
    const implicit = { ...deps, implicitTrackedIds: async () => [ID] };
    await runCalendarTracking(implicit);
    await runCalendarTracking(implicit);
    portalDown = true;
    await runCalendarTracking(implicit);
    expect(mem.tracking.has(ID)).toBe(false);
  });
});

describe("cierre del calendario de hitos vs. vigilancia de contratos", () => {
  beforeEach(() => { Object.values(mem).forEach((m) => m.clear()); sent.length = 0; watchdog.length = 0; portalDown = false; portal = fixture; });

  it("al publicarse el acta de fallo con estatus terminal se cierra SOLO el seguimiento de hitos; el watchdog no se desactiva", async () => {
    await enableTracking(ID, "123", 1, deps);
    const data = JSON.parse(JSON.stringify(fixture));
    data.registro[0].estatus = "ADJUDICADO";
    data.anexos = [...data.anexos, { numero: 9, descripcion: "ACTA DE FALLO", tipodoc_descripcion: "ACTA DE FALLO", nombre_archivo: "FA.pdf", uuid_documento: "u-fa", fecha_creacion: "2026-11-24T19:00:00" }];
    portal = data;
    await runCalendarTracking(deps);
    expect(mem.tracking.get(ID)).toMatchObject({ enabled: false });
    expect(watchdog).toEqual([`on:${ID}`]); // sin `off:`: la vigilancia de contratos y convenios sigue
  });

  it("los folios de la vigilancia prioritaria no los avisa el calendario (un solo avisador por evento)", async () => {
    const watched = { ...deps, loadProcurement: async () => ({ ...info, expediente: "LA-12-NEF-012NEF001-N-3-2027" }) };
    await enableTracking(ID, "123", 1, watched);
    portal = (() => { const d = JSON.parse(JSON.stringify(fixture)); d.registro[0].fecha_apertura = "2026-11-26T10:00:00"; return d; })();
    const run = await runCalendarTracking(watched);
    expect(run).toMatchObject({ tracked: 0, notified: 0 });
    expect(sent).toHaveLength(0);
  });
});
