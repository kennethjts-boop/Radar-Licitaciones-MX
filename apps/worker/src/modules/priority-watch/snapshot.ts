/** Construcción pura del estado de un procedimiento desde la captura de Compras MX. */
import { createHash } from "crypto";
import { normalizeText } from "../../core/text";
import { calendarFromComprasMxDetail } from "../procurement-calendar/extract";
import type {
  DocCategory, StatusKind, WatchContract, WatchDocument, WatchPartida, WatchSnapshot, WatchedProcedure,
} from "./types";

export interface PortalCapture {
  detail: Record<string, unknown> & {
    registro?: Array<Record<string, unknown>>; anexos?: unknown; req_economicos?: unknown[]; drc?: unknown;
  };
  reqeconomicos?: unknown;
  anexosApi?: unknown;
  capturedAt: string;
  officialUrl: string;
}

const sha = (value: string): string => createHash("sha1").update(value).digest("hex").slice(0, 12);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

export function statusKindOf(status: string | null): StatusKind {
  const text = normalizeText(status ?? "");
  if (!text) return "otro";
  if (/adjudic/.test(text)) return "adjudicado";
  if (/desiert/.test(text)) return "desierto";
  if (/cancel/.test(text)) return "cancelado";
  if (/vigente|publicad|en proceso|sin acta|pendiente/.test(text)) return "vigente";
  return "otro";
}

export function categoryOf(tipo: string, descripcion: string): DocCategory {
  const text = normalizeText(`${tipo} ${descripcion}`);
  if (/suspension|diferimient|difiere|reprogram|pospon|cambio de fecha/.test(text)) return "aviso";
  if (/acta de fallo|acta fallo|notificacion de fallo/.test(text)) return "acta_fallo";
  if (/acta de apertura|acta apertura|presentacion y apertura/.test(text)) return "acta_apertura";
  if (/acta.*junta|junta de aclaraciones/.test(text)) return "acta_junta";
  if (/convenio/.test(text)) return "convenio";
  if (/contrato/.test(text) && !/modelo de contrato/.test(text)) return "contrato";
  if (/convocatoria|anexo|bases|modelo de contrato|licitacion|requisito/.test(text)) return "bases_anexos";
  return "otro";
}

interface AnexoRow {
  uuid_documento?: string | null; nombre_archivo?: string | null; descripcion?: string | null;
  tipodoc_descripcion?: string | null; fecha_creacion?: string | null; fecha_modificacion?: string | null;
}

export function documentsFrom(anexos: unknown, anexosApi: unknown): { documents: WatchDocument[]; complete: boolean } {
  const rows = new Map<string, AnexoRow>();
  const add = (list: unknown) => {
    for (const item of Array.isArray(list) ? (list as AnexoRow[]) : []) {
      const id = item.uuid_documento ?? `${item.nombre_archivo ?? item.descripcion ?? "anexo"}@${item.fecha_creacion ?? ""}`;
      if (!rows.has(id)) rows.set(id, item);
    }
  };
  add(anexos);
  const api = (anexosApi as { data?: Array<{ registros?: unknown; paginacion?: Array<{ total_registros?: number }> }> } | undefined)?.data?.[0];
  add(api?.registros);
  const documents = [...rows.entries()].map(([id, item]) => {
    const tipo = str(item.tipodoc_descripcion) ?? "";
    const descripcion = str(item.descripcion) ?? tipo;
    return {
      id, tipo, descripcion, nombre: str(item.nombre_archivo), createdAt: str(item.fecha_creacion),
      modifiedAt: str(item.fecha_modificacion), category: categoryOf(tipo, descripcion),
    } satisfies WatchDocument;
  }).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  const reportedTotal = api?.paginacion?.[0]?.total_registros;
  // El portal reporta cuántos documentos tiene; si leímos menos, la lista no es concluyente.
  const complete = documents.length > 0 && (typeof reportedTotal !== "number" || documents.length >= reportedTotal);
  return { documents, complete };
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };

export function partidaRefsIn(text: string | null): number[] {
  const refs = new Set<number>();
  for (const match of (text ?? "").matchAll(/partida\s+(\d+)/gi)) refs.add(Number(match[1]));
  for (const match of (text ?? "").matchAll(/regi[oó]n\s+([IVX]+)\b/gi)) {
    const value = ROMAN[match[1].toUpperCase()];
    if (value) refs.add(value);
  }
  return [...refs].sort((a, b) => a - b);
}

interface ReqRow { descripcion_detallada?: string; monto_minimo?: number | null; monto_maximo?: number | null }

export function partidasFrom(
  watched: WatchedProcedure, reqeconomicos: unknown, detailReq: unknown[] | undefined,
): { partidas: WatchPartida[]; complete: boolean; reason: string | null } {
  const data = (reqeconomicos as { data?: Array<{ registros?: Array<{ data_registros?: ReqRow[] }>; paginacion?: Array<{ total_registros?: number; total_paginas?: number }> }> } | undefined)?.data?.[0];
  const rows = (data?.registros ?? []).flatMap((group) => group.data_registros ?? []);
  if (rows.length === 0) {
    return { partidas: [], complete: false, reason: "El portal no devolvió la tabla de partidas (vacía o aún cargando)" };
  }
  const reported = data?.paginacion?.[0];
  let reason: string | null = null;
  if ((reported?.total_paginas ?? 1) > 1 || (typeof reported?.total_registros === "number" && reported.total_registros !== rows.length)) {
    reason = `Lista parcial: el portal reporta ${reported?.total_registros} partidas y se leyeron ${rows.length}`;
  } else if (Array.isArray(detailReq) && detailReq.length !== rows.length) {
    reason = `El detalle lista ${detailReq.length} partidas y la tabla ${rows.length}`;
  }
  const partidas = rows.map((row, index) => {
    const descripcion = str(row.descripcion_detallada) ?? `Partida ${index + 1}`;
    const refs = partidaRefsIn(descripcion);
    const n = /^partida\s+\d+/i.test(descripcion) ? refs[0] ?? null : null;
    const h = watched.highlight;
    return {
      n, key: n !== null ? `P${n}` : sha(descripcion), descripcion, minMonto: num(row.monto_minimo), maxMonto: num(row.monto_maximo),
      highlighted: Boolean(h && ((n !== null && h.partidaNumbers.includes(n)) || h.textPattern.test(descripcion))),
    } satisfies WatchPartida;
  });
  return { partidas, complete: reason === null, reason };
}

interface DrcRow {
  cod_drc?: string; ref_interno?: string; licitante?: string; titulo_contrato?: string; estatus_nombre?: string;
  fecha_inicio_contrato?: string; fecha_fin_contrato?: string; importe?: number; importe_max?: number;
  importe_impuesto?: number; importe_impuesto_max?: number; nombre_moneda?: string; fecha_publicacion?: string; adicional?: string | null;
}

export function contractsFrom(drc: unknown): WatchContract[] {
  return (Array.isArray(drc) ? (drc as DrcRow[]) : []).map((row, index) => ({
    id: str(row.cod_drc) ?? `${str(row.ref_interno) ?? "contrato"}-${index}`,
    numero: str(row.ref_interno), licitante: str(row.licitante), titulo: str(row.titulo_contrato), estatus: str(row.estatus_nombre),
    inicio: str(row.fecha_inicio_contrato), fin: str(row.fecha_fin_contrato), importeMin: num(row.importe), importeMax: num(row.importe_max),
    importeMinIva: num(row.importe_impuesto), importeMaxIva: num(row.importe_impuesto_max), moneda: str(row.nombre_moneda),
    publicadoAt: str(row.fecha_publicacion), partidas: partidaRefsIn(`${row.titulo_contrato ?? ""} ${row.adicional ?? ""}`),
  }));
}

const TECHNICAL: Array<[RegExp, string]> = [
  [/software|sistema informatico|plataforma/, "software"],
  [/trazabilidad|por lote|lotes?\b|caducidad/, "trazabilidad por lote"],
  [/integracion|interfaz|interoperab|sistemas? de birmex|\bwms\b|\berp\b/, "integración con sistemas de BIRMEX"],
  [/inventario|conteo|existencias/, "inventarios"],
  [/cadena de frio|temperatura controlada|red fria|refrigerad/, "cadena de frío"],
];

export function technicalFlagsIn(text: string): string[] {
  const normalized = normalizeText(text);
  return TECHNICAL.filter(([pattern]) => pattern.test(normalized)).map(([, label]) => label);
}

export function buildWatchSnapshot(watched: WatchedProcedure, capture: PortalCapture): WatchSnapshot | null {
  const record = capture.detail.registro?.[0];
  if (!record) return null;
  const calendar = calendarFromComprasMxDetail({
    procurementId: watched.procedure, officialUrl: capture.officialUrl, capturedAt: capture.capturedAt,
    data: capture.detail as never,
  });
  if (!calendar) return null;
  const { documents, complete: docsComplete } = documentsFrom(capture.detail.anexos, capture.anexosApi);
  const parts = partidasFrom(watched, capture.reqeconomicos, capture.detail.req_economicos as unknown[] | undefined);
  const description = `${str(record.nombre_procedimiento) ?? ""} ${str(record.descripcion) ?? ""}`;
  const portalStatus = str(record.estatus_alterno) ?? str(record.estatus);
  return {
    procedure: watched.procedure, expediente: str(record.cod_expediente) ?? watched.expediente, capturedAt: capture.capturedAt,
    officialUrl: capture.officialUrl, portalStatus, statusKind: statusKindOf(portalStatus),
    currency: str(record.descripcion_moneda), calendar,
    estimatedContractStart: str(record.fecha_estimada_contrato),
    documents, docsComplete, partidas: parts.partidas, partidasComplete: parts.complete, partidasReason: parts.reason,
    contracts: contractsFrom(capture.detail.drc), descriptionHash: sha(normalizeText(description)),
    technicalFlags: technicalFlagsIn(description),
  };
}
