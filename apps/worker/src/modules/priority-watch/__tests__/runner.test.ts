jest.mock("../../../core/lock", () => ({ withDistributedLock: jest.fn() }));
jest.mock("../../../storage/client", () => ({ getSupabaseClient: () => ({ from: () => ({ upsert: async () => ({ error: null }) }) }) }));
jest.mock("../../../config/env", () => ({ getConfig: () => ({ RAILWAY_GIT_COMMIT_SHA: "test-sha" }) }));
jest.mock("../../../alerts/telegram.alerts", () => ({ ...jest.requireActual("../../../alerts/telegram.alerts"), sendTelegramMessage: jest.fn() }));
jest.mock("../source", () => ({ capturePortal: jest.fn() }));
jest.mock("../../../core/logger", () => ({ createModuleLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { _resetAwaitingRecordForTests, classifySendFailure, enqueueEvents } from "../outbox";
import { backoffMs, runPriorityWatch, type RunnerDeps } from "../runner";
import { emptyState, type StateStore, type WatchState } from "../store";
import type { OutboxEntry, WatchedProcedure } from "../types";
import { W3, W306, addAnexo, anexo, capture3, capture306, emptyPartidas } from "./helpers";
import type { PortalCapture } from "../snapshot";

class Mem {
  states = new Map<string, WatchState>();
  outboxes = new Map<string, OutboxEntry[]>();
  failSaveSent = false;
  stateStore: StateStore = {
    load: async (p) => structuredClone(this.states.get(p) ?? emptyState()),
    save: async (p, s) => { this.states.set(p, structuredClone(s)); },
  };
  outbox = {
    load: async (p: string) => structuredClone(this.outboxes.get(p) ?? []),
    save: async (p: string, e: OutboxEntry[]) => {
      if (this.failSaveSent && e.some((x) => x.state === "sent" && !(this.outboxes.get(p) ?? []).some((o) => o.eventId === x.eventId && o.state === "sent"))) {
        throw new Error("db down");
      }
      this.outboxes.set(p, structuredClone(e));
    },
  };
}

let clock = new Date("2026-11-09T04:30:00.000Z");
const at = (minutes: number) => { clock = new Date(clock.getTime() + minutes * 60_000); };
const captures = new Map<string, () => PortalCapture | Error>();
const sends: Array<{ eventId: string; text: string; url: string | null }> = [];
let sendImpl: (entry: OutboxEntry, text: string) => Promise<number> = async () => 1000 + sends.length;
let mem: Mem;

const deps = (): RunnerDeps => ({
  capture: async (w: WatchedProcedure) => { const r = captures.get(w.procedure)!(); if (r instanceof Error) throw r; return r; },
  state: mem.stateStore, outbox: mem.outbox, now: () => clock,
  procurementId: async (p) => `uuid-${p}`,
  async send(entry, text, url) {
    const id = await sendImpl(entry, text);
    sends.push({ eventId: entry.eventId, text, url });
    return id;
  },
});

const base306 = () => capture306(undefined, clock.toISOString());
const base3 = () => capture3(undefined, clock.toISOString());

beforeEach(() => {
  mem = new Mem(); sends.length = 0; clock = new Date("2026-11-09T04:30:00.000Z");
  captures.clear(); captures.set(W306.procedure, base306); captures.set(W3.procedure, base3);
  sendImpl = async () => 1000 + sends.length;
  _resetAwaitingRecordForTests();
});

describe("línea base y lectura inicial", () => {
  it("la lectura inicial de ambos folios guarda lo publicado sin avisos históricos en lote", async () => {
    const results = await runPriorityWatch(deps());
    expect(results.map((r) => [r.procedure, r.status, r.events])).toEqual([[W306.procedure, "baseline", 0], [W3.procedure, "baseline", 0]]);
    expect(sends).toHaveLength(0);
    const report = mem.states.get(W306.procedure)!.initialReport as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(report).toMatchObject({ portalStatus: "ADJUDICADO", fallo: "2026-11-05T18:00:00", actaFallo: "2026-11-05T19:38:54", currency: "PESO MEXICANO" });
    expect(report.contracts[0]).toMatchObject({ licitante: "OPERADORA DE SERVICIOS MEDICOS ML SA DE CV", importeMax: 1249738324 });
    expect(mem.states.get(W306.procedure)!.pendingVerification.join(" ")).toContain("acta de fallo");
    expect(mem.states.get(W3.procedure)!.partidasCoverage.status).toBe("ok");
  });
});

describe("un cambio = un aviso", () => {
  it("diferimiento: se persiste antes de enviar, se envía una vez y los ciclos repetidos no lo repiten", async () => {
    await runPriorityWatch(deps());
    captures.set(W3.procedure, () => capture3((c) => addAnexo(c, anexo("AVISO DIFERIMIENTO DE JUNTA DE ACLARACIONES", "u-dif", "2026-11-09T09:00:00", "AVISO", "JA.pdf")), clock.toISOString()));
    let persistedBeforeSend = false;
    sendImpl = async (entry) => { persistedBeforeSend = mem.outboxes.get(W3.procedure)!.some((e) => e.eventId === entry.eventId && e.state === "sending"); return 4242; };
    at(15); const first = await runPriorityWatch(deps());
    expect(persistedBeforeSend).toBe(true);
    expect(first[1]).toMatchObject({ events: 1, delivery: { sent: 1 } });
    at(15); await runPriorityWatch(deps());
    at(15); await runPriorityWatch(deps());
    expect(sends).toHaveLength(1);
    expect(sends[0].url).toContain("/detalle/8d0517be786f4f878c109c5d861226ce/");
    const entry = mem.outboxes.get(W3.procedure)![0];
    expect(entry).toMatchObject({ state: "sent", messageId: 4242, attempts: 1, uncertain: false });
  });

  it("dos folios con novedades se avisan por separado; el estado de cada uno es independiente", async () => {
    await runPriorityWatch(deps());
    captures.set(W3.procedure, () => capture3((c) => { (c.detail.registro as any[])[0].fecha_apertura = "2026-11-26T10:00:00"; }, clock.toISOString())); // eslint-disable-line @typescript-eslint/no-explicit-any
    captures.set(W306.procedure, () => capture306((c) => { (c.detail.drc as any[])[0].estatus_nombre = "FORMALIZADO"; }, clock.toISOString())); // eslint-disable-line @typescript-eslint/no-explicit-any
    at(15); await runPriorityWatch(deps());
    expect(sends.map((s) => s.eventId.split("|")[0]).sort()).toEqual([W3.procedure, W306.procedure].sort());
  });
});

describe("fallas de fuente por folio", () => {
  it("el portal falla solo para N-3-2027: N-306 se revisa, N-3 conserva su último estado y entra en espera progresiva", async () => {
    await runPriorityWatch(deps());
    captures.set(W3.procedure, () => new Error("401 sesión expirada"));
    at(15); const results = await runPriorityWatch(deps());
    expect(results[0]).toMatchObject({ procedure: W306.procedure, checked: true, status: "ok" });
    expect(results[1]).toMatchObject({ procedure: W3.procedure, checked: false, status: "failed" });
    const state = mem.states.get(W3.procedure)!;
    expect(state.baseline?.partidas).toHaveLength(7); // último estado confirmado intacto
    expect(state.consecutiveFailures).toBe(1);
    // dentro de la espera no se consulta; tras ella se reintenta y se recupera
    at(5); expect((await runPriorityWatch(deps()))[1].status).toBe("backoff");
    captures.set(W3.procedure, base3);
    at(20); expect((await runPriorityWatch(deps()))[1]).toMatchObject({ status: "ok", checked: true });
    expect(mem.states.get(W3.procedure)!.consecutiveFailures).toBe(0);
    expect(sends).toHaveLength(0);
  });

  it("espera progresiva: 15, 30, 60 y 120 minutos como tope", () => {
    expect([1, 2, 3, 4, 9].map(backoffMs)).toEqual([15, 30, 60, 120, 120].map((m) => m * 60_000));
  });

  it("un portal que llega con otro expediente no contamina el estado", async () => {
    await runPriorityWatch(deps());
    captures.set(W3.procedure, () => capture306(undefined, clock.toISOString()));
    at(15); const [, second] = await runPriorityWatch(deps());
    expect(second).toMatchObject({ status: "failed" });
    expect(mem.states.get(W3.procedure)!.baseline?.expediente).toBe("E-2026-00113902");
  });
});

describe("tabla de partidas vacía o incompleta (structural_incomplete de N-3-2027)", () => {
  it("conserva las partidas, no avisa desapariciones, un acta nueva sigue su curso y la cobertura se degrada si persiste", async () => {
    await runPriorityWatch(deps());
    captures.set(W3.procedure, () => capture3((c) => { emptyPartidas(c); addAnexo(c, anexo("ACTA DE JUNTA DE ACLARACIONES", "u-acta-ja", "2026-11-09T12:00:00", "ACTA JUNTA DE ACLARACIONES", "ACTA_JA.pdf")); }, clock.toISOString()));
    at(15); await runPriorityWatch(deps());
    expect(sends).toHaveLength(1); // solo el acta, nada de «partidas desaparecidas»
    expect(sends[0].text).toContain("Acta de junta de aclaraciones publicada");
    expect(sends[0].text).not.toMatch(/desaparec|retirad/i);
    let state = mem.states.get(W3.procedure)!;
    expect(state.baseline?.partidas).toHaveLength(7);
    expect(state.partidasCoverage).toMatchObject({ status: "transient", consecutive: 1 });
    at(15); await runPriorityWatch(deps());
    at(15); await runPriorityWatch(deps());
    state = mem.states.get(W3.procedure)!;
    expect(state.partidasCoverage).toMatchObject({ status: "degraded", consecutive: 3 });
    expect(state.partidasCoverage.reason).toContain("no devolvió la tabla de partidas");
    expect(sends).toHaveLength(1); // sin avisos repetidos
    captures.set(W3.procedure, () => capture3((c) => addAnexo(c, anexo("ACTA DE JUNTA DE ACLARACIONES", "u-acta-ja", "2026-11-09T12:00:00", "ACTA JUNTA DE ACLARACIONES", "ACTA_JA.pdf")), clock.toISOString()));
    at(15); await runPriorityWatch(deps());
    expect(mem.states.get(W3.procedure)!.partidasCoverage.status).toBe("ok");
  });
});

describe("entrega a Telegram: fallida vs incierta", () => {
  it("más de 200 eventos no expulsa pendientes ni pierde la identidad de avisos entregados", () => {
    const existing: OutboxEntry[] = Array.from({ length: 201 }, (_, n) => ({
      eventId: `${W3.procedure}|evento|${n}`, kind: "acta_junta", text: "acta", url: null,
      createdAt: clock.toISOString(), state: n === 0 ? "pending" : "sent", attempts: 0,
      nextAttemptAt: null, sendingAt: null, sentAt: null, messageId: null, lastError: null, uncertain: false,
    }));
    const event = { eventId: `${W3.procedure}|evento|nuevo`, kind: "acta_junta" as const, title: "acta", details: [], highlighted: false };
    const queued = enqueueEvents(existing, [{ event, text: "nueva", url: null }], clock.toISOString());
    expect(queued.entries).toHaveLength(202);
    expect(queued.entries[0].state).toBe("pending");
    expect(enqueueEvents(queued.entries, [{ event: { ...event, eventId: existing[1].eventId }, text: "repetida", url: null }], clock.toISOString()).added).toBe(0);
  });
  const withEvent = async () => {
    await runPriorityWatch(deps());
    captures.set(W3.procedure, () => capture3((c) => { (c.detail.registro as any[])[0].fecha_apertura = "2026-11-26T10:00:00"; }, clock.toISOString())); // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const entry = () => mem.outboxes.get(W3.procedure)![0];

  it("clasifica los errores: rechazo definitivo, sin entrega e incierto", () => {
    expect(classifySendFailure(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe("not_sent");
    expect(classifySendFailure(Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }))).toBe("uncertain");
    expect(classifySendFailure(new Error("socket hang up"))).toBe("uncertain");
  });

  it("envío fallido sin entrega: se reintenta con espera y NO se marca como reenvío", async () => {
    await withEvent();
    sendImpl = async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); };
    at(15); await runPriorityWatch(deps());
    expect(entry()).toMatchObject({ state: "pending", attempts: 1, uncertain: false });
    expect(sends).toHaveLength(0);
    sendImpl = async () => 777;
    at(0.5); await runPriorityWatch(deps()); // dentro de la espera: no reintenta
    expect(sends).toHaveLength(0);
    at(5); await runPriorityWatch(deps());
    expect(sends).toHaveLength(1);
    expect(sends[0].text).not.toContain("Reenvío");
    expect(entry()).toMatchObject({ state: "sent", messageId: 777, uncertain: false });
  });

  it("entrega incierta (tiempo agotado): se reenvía UNA vez marcada como reenvío", async () => {
    await withEvent();
    sendImpl = async () => { throw Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }); };
    at(15); await runPriorityWatch(deps());
    expect(entry()).toMatchObject({ state: "sending", uncertain: true });
    sendImpl = async () => 888;
    at(1); await runPriorityWatch(deps()); // aún no pasan 2 min: otra ejecución podría estar enviando
    expect(sends).toHaveLength(0);
    at(15); await runPriorityWatch(deps());
    at(15); await runPriorityWatch(deps());
    expect(sends).toHaveLength(1);
    expect(sends[0].text).toContain("Reenvío: la entrega anterior de este aviso no pudo confirmarse");
    expect(entry()).toMatchObject({ state: "sent", messageId: 888, uncertain: true });
  });

  it("reinicio con el envío en vuelo: la intención persistida (`sending`) se trata como entrega incierta", async () => {
    await withEvent();
    sendImpl = async () => { throw new Error("proceso reiniciado"); };
    // Simula que el proceso murió justo tras persistir `sending`: se deja la entrada así.
    at(15); await runPriorityWatch(deps());
    const stored = mem.outboxes.get(W3.procedure)!;
    stored[0].uncertain = false; // el reinicio pierde la bandera en memoria; solo queda el estado persistido
    mem.outboxes.set(W3.procedure, stored);
    sendImpl = async () => 999;
    at(15); await runPriorityWatch(deps());
    expect(sends).toHaveLength(1);
    expect(sends[0].text).toContain("Reenvío");
    expect(entry().state).toBe("sent");
    at(15); await runPriorityWatch(deps());
    expect(sends).toHaveLength(1);
  });

  it("rechazo definitivo de Telegram (HTTP 400): no se reintenta", async () => {
    await withEvent();
    sendImpl = async () => { throw Object.assign(new Error("ETELEGRAM: 400 Bad Request: can't parse entities"), { code: "ETELEGRAM", response: { statusCode: 400, body: { ok: false, error_code: 400, description: "Bad Request: can't parse entities" } } }); };
    at(15); await runPriorityWatch(deps());
    expect(entry().state).toBe("dead");
    at(60); await runPriorityWatch(deps());
    expect(sends).toHaveLength(0);
  });

  it("mensaje entregado pero el asiento falla: solo se reintenta el asiento, no el envío (ventana documentada)", async () => {
    await withEvent();
    sendImpl = async () => 555;
    mem.failSaveSent = true;
    at(15); await runPriorityWatch(deps());
    expect(sends).toHaveLength(1);
    mem.failSaveSent = false;
    at(15); await runPriorityWatch(deps());
    expect(sends).toHaveLength(1); // sin duplicar
    expect(entry()).toMatchObject({ state: "sent", messageId: 555 });
  });
});

describe("ejecuciones simultáneas", () => {
  it("el lock del ciclo serializa dos ejecuciones a la vez: una se omite y hay un solo envío por evento", async () => {
    const lockState = { held: false };
    const lockMock = jest.requireMock("../../../core/lock") as { withDistributedLock: jest.Mock };
    lockMock.withDistributedLock.mockImplementation(async (_name: string, _job: string, fn: () => Promise<unknown>) => {
      if (lockState.held) return null; // otro ciclo (o instancia) ya lo tiene
      lockState.held = true;
      try { return await fn(); } finally { lockState.held = false; }
    });
    const { runPriorityWatchJob } = await import("../job");
    await runPriorityWatch(deps());
    captures.set(W3.procedure, () => capture3((c) => { (c.detail.registro as any[])[0].fecha_apertura = "2026-11-26T10:00:00"; }, clock.toISOString())); // eslint-disable-line @typescript-eslint/no-explicit-any
    at(15);
    const [a, b] = await Promise.all([runPriorityWatchJob(deps()), runPriorityWatchJob(deps())]);
    expect([a, b].filter((r) => r === null)).toHaveLength(1);
    at(15); await runPriorityWatchJob(deps());
    expect(sends).toHaveLength(1);
    expect(mem.outboxes.get(W3.procedure)!).toHaveLength(1);
  });

  it("sin lock, la identidad del evento evita dos entradas de bandeja para el mismo cambio", async () => {
    await runPriorityWatch(deps());
    captures.set(W3.procedure, () => capture3((c) => { (c.detail.registro as any[])[0].fecha_apertura = "2026-11-26T10:00:00"; }, clock.toISOString())); // eslint-disable-line @typescript-eslint/no-explicit-any
    at(15);
    await Promise.all([runPriorityWatch(deps()), runPriorityWatch(deps())]);
    expect(mem.outboxes.get(W3.procedure)!).toHaveLength(1);
  });
});
