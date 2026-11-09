import n306 from "./fixtures/n306-adjudicado.json";
import n3 from "./fixtures/n3-2027-prefallo.json";
import { buildWatchSnapshot, type PortalCapture } from "../snapshot";
import { WATCHED_PROCEDURES, type WatchSnapshot, type WatchedProcedure } from "../types";

export const W306 = WATCHED_PROCEDURES[0];
export const W3 = WATCHED_PROCEDURES[1];
export const URL306 = "https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/4d8532fd8b77462aa7da2b73afb236b5/procedimiento";
export const URL3 = "https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/8d0517be786f4f878c109c5d861226ce/procedimiento";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export function capture306(edit?: (c: PortalCapture & Json) => void, at = "2026-11-09T04:30:00.000Z"): PortalCapture {
  const c = { ...clone(n306), capturedAt: at, officialUrl: URL306 } as PortalCapture & Json;
  edit?.(c);
  return c;
}
export function capture3(edit?: (c: PortalCapture & Json) => void, at = "2026-11-09T04:30:00.000Z"): PortalCapture {
  const c = { ...clone(n3), capturedAt: at, officialUrl: URL3 } as PortalCapture & Json;
  edit?.(c);
  return c;
}
export const snap = (watched: WatchedProcedure, capture: PortalCapture): WatchSnapshot => buildWatchSnapshot(watched, capture)!;

/** Vacía la tabla de requerimientos económicos (el portal aún está hidratando). */
export const emptyPartidas = (c: PortalCapture & Json): void => {
  c.reqeconomicos = { success: true, data: [{ registros: [{ numero_grupo: 1, grupo: "PARTIDA SOLA", data_registros: [] }], paginacion: [{ total_registros: 0, total_paginas: 1 }] }] };
  c.detail.req_economicos = [];
};

export const anexo = (descripcion: string, uuid: string, fecha: string, tipo = descripcion, nombre: string | null = null): Json => ({
  numero: 50, descripcion, tipodoc_descripcion: tipo, nombre_archivo: nombre, uuid_documento: uuid, fecha_creacion: fecha, fecha_modificacion: fecha,
});
export const addAnexo = (c: PortalCapture & Json, item: Json): void => {
  c.detail.anexos = [...(c.detail.anexos as Json[]), item];
  const api = c.anexosApi as Json;
  api.data[0].registros = [...api.data[0].registros, item];
  api.data[0].paginacion[0].total_registros += 1;
};
