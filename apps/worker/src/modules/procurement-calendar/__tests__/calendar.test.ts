import fixture from "./fixtures/birmex-n3-2027.detail.json";
import { calendarFromComprasMxDetail, calendarFromSecogem, toMilestone } from "../extract";
import { diffCalendars } from "../diff";
import { formatCalendarMessage, formatChangeMessage, formatLocalMilestone } from "../format";
import { calendarKeyboard } from "../keyboard";
import type { CalendarSnapshot } from "../types";

const ID = "cf2458a7-d351-4f07-be07-84ac1da0764e";
const URL = "https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/8d0517be786f4f878c109c5d861226ce/procedimiento";
const snap = (over: { data?: unknown; at?: string } = {}) => calendarFromComprasMxDetail({
  procurementId: ID, officialUrl: URL, capturedAt: over.at ?? "2026-11-09T03:10:00.000Z", data: (over.data ?? fixture) as never,
})!;

describe("calendario oficial de BIRMEX LA-12-NEF-012NEF001-N-3-2027 (detalle real)", () => {
  it("la apertura oficial es el 19 de noviembre de 2026 a las 10:00", () => {
    const calendar = snap();
    expect(calendar.milestones.presentacion_apertura).toEqual({ at: "2026-11-19T10:00:00", hasTime: true });
    expect(formatLocalMilestone(calendar.milestones.presentacion_apertura)).toBe("19/11/2026 10:00");
    expect(formatLocalMilestone(calendar.milestones.publicacion)).toBe("20/10/2026 20:21");
    expect(formatLocalMilestone(calendar.milestones.junta_aclaraciones)).toBe("29/10/2026 10:00");
    expect(formatLocalMilestone(calendar.milestones.fallo)).toBe("24/11/2026 18:00");
    expect(calendar.verified).toHaveLength(4);
  });

  it("detecta los avisos de suspensión/diferimiento de la junta y que aún no hay acta de fallo", () => {
    const calendar = snap();
    expect(calendar.clarificationNotices.map((n) => n.kind)).toEqual(["suspension", "suspension", "diferimiento"]);
    expect(calendar.falloActa).toBeNull();
  });

  it("el mensaje muestra cuatro hitos, distingue publicación oficial de detección y usa hora de CDMX", () => {
    const text = formatCalendarMessage(snap(), {
      title: "SERVICIO INTEGRADO REGIONAL", firstDetectedAt: "2026-11-09T02:48:19.686Z", tracking: false,
    });
    expect(text).toContain("Publicación de la convocatoria:</b> 20/10/2026 20:21");
    expect(text).toContain("Presentación y apertura de proposiciones:</b> 19/11/2026 10:00");
    expect(text).toContain("Fallo:</b> 24/11/2026 18:00");
    expect(text).toContain("Publicación oficial: 20/10/2026 20:21");
    // 02:48 UTC del 9-nov = 20:48 del 8-nov en CDMX
    expect(text).toContain("Detectado por el radar: 08/11/2026 20:48 CDMX");
    expect(text).not.toContain("09/11/2026 02:48");
    expect(text).toContain("avisos oficiales de suspensión o diferimiento");
    expect(text).toContain("Abrir expediente oficial");
  });

  it("una fecha sin publicar se indica como «Sin publicar»", () => {
    const data = JSON.parse(JSON.stringify(fixture));
    data.registro[0].fecha_acto_fallo = null;
    const text = formatCalendarMessage(snap({ data }), {});
    expect(text).toContain("Fallo:</b> Sin publicar");
  });

  it("muestra la fecha límite de entrega junto a la apertura cuando la fuente la distingue", () => {
    const calendar = calendarFromComprasMxDetail({
      procurementId: ID, officialUrl: URL, capturedAt: "2026-11-09T03:10:00.000Z", data: fixture as never,
      listingDeadline: "2026-11-18T14:00:00",
    })!;
    const text = formatCalendarMessage(calendar, {});
    expect(text).toContain("Fecha límite de entrega de proposiciones: 18/11/2026 14:00");
    expect(text).toContain("Presentación y apertura de proposiciones:</b> 19/11/2026 10:00");
  });

  it("fuente solo PDF (SECOGEM): indica qué hitos se pudieron verificar", () => {
    const calendar = calendarFromSecogem({
      procurementId: ID, expediente: "ISEM-LPNP-036y037-2026", officialUrl: "https://portal.secogem.gob.mx/x.pdf",
      capturedAt: "2026-11-09T03:10:00.000Z", rawJson: { fecha_publicacion_oficial: "2026-11-03", fecha_apertura: null },
    });
    expect(calendar.verified).toEqual(["publicacion"]);
    const text = formatCalendarMessage(calendar, {});
    expect(text).toContain("Publicación de la convocatoria:</b> 03/11/2026");
    expect(text).toContain("Junta de aclaraciones:</b> No verificable en esta fuente");
    expect(text).toContain("Hitos verificados: Publicación de la convocatoria. No verificables en esta fuente: Junta de aclaraciones");
  });

  it("normaliza fechas y horas", () => {
    expect(toMilestone("2026-12-01T00:00:00")).toEqual({ at: "2026-12-01T00:00:00", hasTime: false });
    expect(toMilestone("19/11/2026 10:00")).toEqual({ at: "2026-11-19T10:00:00", hasTime: true });
    expect(toMilestone(null)).toEqual({ at: null, hasTime: false });
  });

  it("los botones llevan el id del expediente y alternan el seguimiento", () => {
    const off = calendarKeyboard(ID, false).inline_keyboard[0];
    expect(off.map((b) => b.text)).toEqual(["📅 Ver calendario", "🔔 Avisarme de cambios"]);
    expect(off[0].callback_data).toBe(`cal:${ID}`);
    expect(off[1].callback_data).toBe(`trk:on:${ID}`);
    expect(calendarKeyboard(ID, true).inline_keyboard[0][1].callback_data).toBe(`trk:off:${ID}`);
    expect(off[1].callback_data!.length).toBeLessThanOrEqual(64);
  });
});

describe("diferencias del calendario", () => {
  const withEdit = (edit: (record: Record<string, unknown>) => void, anexos?: unknown[]): CalendarSnapshot => {
    const data = JSON.parse(JSON.stringify(fixture));
    edit(data.registro[0]);
    if (anexos) data.anexos = [...data.anexos, ...anexos];
    return snap({ data });
  };

  it("apertura modificada: muestra anterior, nueva y enlace", () => {
    const before = snap();
    const after = withEdit((r) => { r.fecha_apertura = "2026-11-26T10:00:00"; });
    const changes = diffCalendars(before, after);
    expect(changes).toHaveLength(1);
    const text = formatChangeMessage(after, changes, { detectedAt: "2026-11-09T04:00:00.000Z" });
    expect(text).toContain("19/11/2026 10:00 → <b>26/11/2026 10:00</b>");
    expect(text).toContain("Abrir expediente oficial");
    expect(text).toContain("Detectado: 08/11/2026 22:00 CDMX");
  });

  it("fecha pendiente que se publica: un solo cambio «nuevo»", () => {
    const before = withEdit((r) => { r.fecha_acto_fallo = null; });
    const after = snap();
    const changes = diffCalendars(before, after);
    expect(changes).toMatchObject([{ kind: "new", dedupeKey: "fallo:2026-11-24T18:00:00" }]);
    expect(formatChangeMessage(after, changes)).toContain("Sin publicar → <b>24/11/2026 18:00</b>");
    expect(diffCalendars(after, after)).toEqual([]);
  });

  it("una fecha que desaparece del portal no es un cambio (se conserva el último valor)", () => {
    const before = snap();
    const after = withEdit((r) => { r.fecha_acto_fallo = null; });
    expect(diffCalendars(before, after)).toEqual([]);
  });

  it("acta de fallo publicada y aviso nuevo de junta", () => {
    const before = snap();
    const after = withEdit(() => undefined, [
      { numero: 9, descripcion: "ACTA DE FALLO", tipodoc_descripcion: "ACTA DE FALLO", nombre_archivo: "fallo.pdf", uuid_documento: "u-fallo", fecha_creacion: "2026-11-24T19:00:00" },
      { numero: 10, descripcion: "AVISO DE DIFERIMIENTO DE JUNTA", tipodoc_descripcion: "AVISO", nombre_archivo: "j4.pdf", uuid_documento: "u-j4", fecha_creacion: "2026-11-09T09:00:00" },
    ]);
    const kinds = diffCalendars(before, after).map((c) => c.kind).sort();
    expect(kinds).toEqual(["acta_fallo", "aviso"]);
  });
});
