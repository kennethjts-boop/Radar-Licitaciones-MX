import { diffWatchSnapshots } from "../events";
import { formatWatchMessage, nextMilestone } from "../format";
import { mergeConfirmed } from "../runner";
import { technicalFlagsIn } from "../snapshot";
import { W3, W306, addAnexo, anexo, capture3, capture306, clone, emptyPartidas, snap } from "./helpers";

describe("lectura real de los dos folios (fixtures del portal)", () => {
  it("N-306-2026: adjudicada, con acta de fallo y contrato; moneda y expediente verificados", () => {
    const s = snap(W306, capture306());
    expect(s).toMatchObject({ expediente: "E-2026-00113872", portalStatus: "ADJUDICADO", statusKind: "adjudicado", currency: "PESO MEXICANO" });
    expect(s.calendar.milestones.fallo.at).toBe("2026-11-05T18:00:00");
    expect(s.documents.find((d) => d.category === "acta_fallo")?.createdAt).toBe("2026-11-05T19:38:54");
    expect(s.contracts).toHaveLength(1);
    expect(s.contracts[0]).toMatchObject({ numero: "BIRMEX-289/2026", licitante: "OPERADORA DE SERVICIOS MEDICOS ML SA DE CV", moneda: "MXN", importeMax: 1249738324, importeMin: 499895608 });
    expect(s.partidas).toHaveLength(20);
    expect(s.partidasComplete).toBe(true);
  });

  it("N-3-2027: 7 partidas completas, Región IV destacada, fallo programado sin resultados", () => {
    const s = snap(W3, capture3());
    expect(s).toMatchObject({ expediente: "E-2026-00113902", statusKind: "vigente", currency: "PESO MEXICANO", partidasComplete: true });
    expect(s.partidas).toHaveLength(7);
    expect(s.partidas.filter((p) => p.highlighted).map((p) => p.descripcion)).toEqual(["PARTIDA 4. REGIÓN IV. ESTADO DE MÉXICO Y ALTA ESPECIALIDAD"]);
    expect(s.calendar.milestones.presentacion_apertura.at).toBe("2026-11-19T10:00:00");
    expect(s.contracts).toEqual([]);
    expect(nextMilestone(s, "2026-11-09T00:00:00")).toBe("Presentación y apertura de proposiciones: 19/11/2026 10:00 CDMX");
  });
});

describe("eventos", () => {
  const prev = snap(W3, capture3());

  it("diferimiento de la junta: un aviso con documento y fecha; la fecha del cronograma no se da por vigente", () => {
    const next = snap(W3, capture3((c) => addAnexo(c, anexo("AVISO DIFERIMIENTO DE JUNTA DE ACLARACIONES", "u-dif-2", "2026-11-09T09:00:00", "AVISO", "JA 4.pdf"))));
    const events = diffWatchSnapshots(W3, prev, next);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "aviso_calendario", title: expect.stringContaining("diferimiento") });
    const text = formatWatchMessage(W3, next, events[0], { detectedAt: "2026-11-09T15:00:00.000Z", nowLocal: "2026-11-09T09:00:00" });
    expect(text).toContain("BIRMEX · VIGILANCIA PRIORITARIA");
    expect(text).toContain("LA-12-NEF-012NEF001-N-3-2027");
    expect(text).toContain("E-2026-00113902");
    expect(text).toContain("Detectado: 09/11/2026 09:00 CDMX");
    expect(text).toContain("Próximo hito confirmado: Presentación y apertura de proposiciones: 19/11/2026 10:00 CDMX");
    expect(text).toContain("Fuente oficial: Compras MX");
    expect(text).toContain("⭐ Región IV · Estado de México y Alta Especialidad");
  });

  it("cambio de apertura: anterior, nueva y una sola identidad de evento", () => {
    const next = snap(W3, capture3((c) => { (c.detail.registro as any[])[0].fecha_apertura = "2026-11-26T10:00:00"; })); // eslint-disable-line @typescript-eslint/no-explicit-any
    const [event] = diffWatchSnapshots(W3, prev, next);
    expect(event).toMatchObject({ kind: "fecha_modificada", eventId: "LA-12-NEF-012NEF001-N-3-2027|cal|presentacion_apertura:2026-11-26T10:00:00" });
    expect(event.details[0]).toBe("Antes: 19/11/2026 10:00 → Ahora: 26/11/2026 10:00 CDMX");
  });

  it("fallo con partidas adjudicadas y partidas sin resultado verificable, Región IV destacada", () => {
    const next = snap(W3, capture3((c) => {
      (c.detail.registro as any[])[0].estatus = "ADJUDICADO"; // eslint-disable-line @typescript-eslint/no-explicit-any
      (c.detail.registro as any[])[0].estatus_alterno = "ADJUDICADO"; // eslint-disable-line @typescript-eslint/no-explicit-any
      addAnexo(c, anexo("ACTA DE FALLO", "u-fallo", "2026-11-24T19:10:00", "ACTA DE FALLO", "ACTA_FA.pdf"));
      const contract = (n: number, who: string, max: number) => ({ cod_drc: `C-${n}`, ref_interno: `BIRMEX-30${n}/2027`, licitante: who, titulo_contrato: `SERVICIO INTEGRADO REGIONAL. PARTIDA ${n}. REGIÓN`, estatus_nombre: "PUBLICADO", importe: max / 2, importe_max: max, importe_impuesto: null, importe_impuesto_max: null, nombre_moneda: "MXN", fecha_publicacion: "2026-11-24T21:00:00", fecha_inicio_contrato: "2026-12-01T00:00:00", fecha_fin_contrato: "2027-12-31T00:00:00" });
      c.detail.drc = [contract(1, "LOGISTICA NORTE SA DE CV", 530327476.8), contract(4, "ALTA ESPECIALIDAD LOGISTICA SA DE CV", 952831894.75)];
    }));
    const events = diffWatchSnapshots(W3, prev, next);
    const fallo = events.filter((e) => e.kind === "fallo");
    expect(fallo).toHaveLength(1); // acta + estatus + contratos = un solo aviso
    expect(events.filter((e) => e.kind === "contrato")).toHaveLength(0); // sus contratos van dentro del aviso de fallo
    const text = fallo[0].details.join("\n");
    expect(text).toContain("resultado parcial");
    expect(text).toContain("⭐ PARTIDA 4. REGIÓN IV. ESTADO DE MÉXICO Y ALTA ESPECIALIDAD → adjudicada a ALTA ESPECIALIDAD LOGISTICA SA DE CV");
    expect(text).toContain("PARTIDA 1. REGIÓN I. PACÍFICO NORTE → adjudicada a LOGISTICA NORTE SA DE CV");
    expect(text).toContain("Partidas sin resultado verificable en el portal (ver acta de fallo)");
    expect(text).toContain("PARTIDA 7. REGIÓN VII. SURESTE");
    expect(text).toContain("Monto sin impuestos: mínimo $476,415,947.38 MXN");
    expect(text).toContain("IVA: no consta en el portal");
    expect(fallo[0].highlighted).toBe(true);
  });

  it("después del fallo siguen los contratos: nuevo contrato formalizado y convenio modificatorio", () => {
    const base = snap(W306, capture306());
    const formalized = snap(W306, capture306((c) => { (c.detail.drc as any[])[0].estatus_nombre = "FORMALIZADO"; (c.detail.drc as any[])[0].importe_max = 1300000000; })); // eslint-disable-line @typescript-eslint/no-explicit-any
    const [mod] = diffWatchSnapshots(W306, base, formalized);
    expect(mod.kind).toBe("contrato_modificado");
    expect(mod.details.join("\n")).toContain("Estatus: PUBLICADO → FORMALIZADO");
    expect(mod.details.join("\n")).toContain("Monto máximo:");
    const withConvenio = snap(W306, capture306((c) => addAnexo(c, anexo("CONVENIO MODIFICATORIO 1", "u-conv", "2026-12-10T12:00:00", "CONVENIO", "CONV1.pdf"))));
    expect(diffWatchSnapshots(W306, base, withConvenio).map((e) => e.kind)).toEqual(["convenio"]);
  });

  it("documentos: bases/anexos nuevos señalan revisión técnica pendiente; acta de apertura menciona participantes", () => {
    const next = snap(W3, capture3((c) => {
      addAnexo(c, anexo("MODIFICACIÓN AL ANEXO TÉCNICO", "u-anx", "2026-11-10T10:00:00", "ANEXO TÉCNICO", "ANEXO_TEC_V2.pdf"));
      addAnexo(c, anexo("ACTA DE APERTURA DE PROPOSICIONES", "u-ap", "2026-11-19T13:00:00", "ACTA DE APERTURA DE PROPOSICIONES", "ACTA_AP.pdf"));
    }));
    const events = diffWatchSnapshots(W3, prev, next);
    expect(events.map((e) => e.kind).sort()).toEqual(["acta_apertura", "bases_anexos"]);
    expect(events.find((e) => e.kind === "bases_anexos")!.details.join(" ")).toContain("trazabilidad por lote");
    expect(events.find((e) => e.kind === "acta_apertura")!.details.join(" ")).toContain("Participantes y ofertas");
  });

  it("descripción modificada con temas técnicos nuevos", () => {
    expect(technicalFlagsIn("integración con los sistemas de BIRMEX, trazabilidad por lote, inventarios y cadena de frío")).toEqual(
      ["trazabilidad por lote", "integración con sistemas de BIRMEX", "inventarios", "cadena de frío"]);
    const next = snap(W3, capture3((c) => { (c.detail.registro as any[])[0].descripcion += " INCLUYE SOFTWARE DE TRAZABILIDAD POR LOTE Y CONTROL DE INVENTARIOS."; })); // eslint-disable-line @typescript-eslint/no-explicit-any
    const [event] = diffWatchSnapshots(W3, prev, next);
    expect(event.kind).toBe("descripcion_modificada");
    expect(event.details[0]).toContain("software");
  });
});

describe("datos que desaparecen o llegan incompletos: ningún aviso y se conserva lo confirmado", () => {
  const prev = snap(W3, capture3());
  it("tabla de partidas vacía (structural_incomplete): sin aviso de desaparición y partidas conservadas", () => {
    const next = snap(W3, capture3(emptyPartidas));
    expect(next.partidasComplete).toBe(false);
    expect(diffWatchSnapshots(W3, prev, next)).toEqual([]);
    expect(mergeConfirmed(prev, next).partidas).toHaveLength(7);
    expect(mergeConfirmed(prev, next).partidasComplete).toBe(true);
  });

  it("lista parcial de partidas o de documentos: no concluyente", () => {
    const partial = snap(W3, capture3((c) => { (c.reqeconomicos as any).data[0].paginacion[0].total_registros = 9; })); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(partial.partidasComplete).toBe(false);
    expect(diffWatchSnapshots(W3, prev, partial)).toEqual([]);
    const docs = snap(W3, capture3((c) => { (c.anexosApi as any).data[0].paginacion[0].total_registros = 12; (c.detail.anexos as any[]).pop(); })); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(docs.docsComplete).toBe(false);
    expect(diffWatchSnapshots(W3, prev, docs)).toEqual([]);
  });

  it("una fecha vencida, un listado vacío o un acta ausente nunca generan desierta, cancelación ni adjudicación", () => {
    const ended = snap(W3, capture3((c) => { (c.detail.registro as any[])[0].fecha_acto_fallo = "2020-01-01T10:00:00"; })); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(diffWatchSnapshots(W3, prev, ended).map((e) => e.kind)).toEqual(["fecha_modificada"]);
    const silent = clone(snap(W3, capture3()));
    silent.portalStatus = null; silent.statusKind = "otro"; silent.contracts = []; silent.documents = [];
    expect(diffWatchSnapshots(W3, prev, silent)).toEqual([]);
    const noStatus = snap(W3, capture3((c) => { const r = (c.detail.registro as any[])[0]; r.estatus = null; r.estatus_alterno = null; })); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(diffWatchSnapshots(W3, prev, noStatus)).toEqual([]);
    expect(mergeConfirmed(prev, noStatus).statusKind).toBe("vigente");
  });

  it("solo el estatus explícito del portal produce cancelación o desierta", () => {
    const cancelled = snap(W3, capture3((c) => { const r = (c.detail.registro as any[])[0]; r.estatus = "CANCELADO"; r.estatus_alterno = "CANCELADO"; })); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(diffWatchSnapshots(W3, prev, cancelled)).toMatchObject([{ kind: "estatus", title: expect.stringContaining("cancelado") }]);
    const desierto = snap(W3, capture3((c) => { const r = (c.detail.registro as any[])[0]; r.estatus = "DESIERTO"; r.estatus_alterno = "DESIERTO"; })); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(diffWatchSnapshots(W3, prev, desierto)[0]).toMatchObject({ kind: "fallo" });
  });

  it("partidas modificadas con listas completas: aviso con el monto anterior y el nuevo", () => {
    const next = snap(W3, capture3((c) => { (c.reqeconomicos as any).data[0].registros[0].data_registros[3].monto_maximo = 1000000000; })); // eslint-disable-line @typescript-eslint/no-explicit-any
    const [event] = diffWatchSnapshots(W3, prev, next);
    expect(event.kind).toBe("partidas_modificadas");
    expect(event.highlighted).toBe(true);
    expect(event.details[0]).toContain("⭐ PARTIDA 4. REGIÓN IV");
  });
});
