/**
 * Vigilancia prioritaria de procedimientos de BIRMEX. Sin IA: todo sale de
 * Compras MX (detalle del expediente) y de lo que ese portal publica.
 */
import type { CalendarSnapshot } from "../procurement-calendar/types";

export interface WatchedProcedure {
  /** Número de procedimiento oficial. */
  procedure: string;
  /** Código de expediente en Compras MX. */
  expediente: string;
  label: string;
  scope: string;
  /** Partidas/regiones que se destacan en cada aviso cuando corresponden. */
  highlight?: { label: string; partidaNumbers: number[]; textPattern: RegExp };
}

export const WATCHED_PROCEDURES: readonly WatchedProcedure[] = [
  {
    procedure: "LA-12-NEF-012NEF001-N-306-2026",
    expediente: "E-2026-00113872",
    label: "Despacho automatizado de medicamentos",
    scope: "Servicio de despacho automatizado de medicamentos para Farmacias del Bienestar",
  },
  {
    procedure: "LA-12-NEF-012NEF001-N-3-2027",
    expediente: "E-2026-00113902",
    label: "Servicio integrado regional de cadena de suministro",
    scope: "Servicio integrado regional de cadena de suministro de insumos para la salud 2027 (7 partidas regionales)",
    highlight: {
      label: "Región IV · Estado de México y Alta Especialidad",
      partidaNumbers: [4],
      textPattern: /regi[oó]n iv\b|estado de m[eé]xico y alta especialidad/i,
    },
  },
];

export const WATCHED_PROCEDURE_NUMBERS: readonly string[] = WATCHED_PROCEDURES.map((item) => item.procedure);
export const isWatchedProcedure = (value: string | null | undefined): boolean =>
  Boolean(value && WATCHED_PROCEDURE_NUMBERS.includes(value));

export type StatusKind = "vigente" | "adjudicado" | "desierto" | "cancelado" | "otro";
export type DocCategory =
  | "bases_anexos" | "acta_junta" | "acta_apertura" | "acta_fallo" | "contrato" | "convenio" | "aviso" | "otro";

export interface WatchDocument {
  id: string;
  tipo: string;
  descripcion: string;
  nombre: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  category: DocCategory;
}

export interface WatchPartida {
  /** Número de partida cuando la descripción lo dice («PARTIDA 4»); null en listados por clave. */
  n: number | null;
  key: string;
  descripcion: string;
  minMonto: number | null;
  maxMonto: number | null;
  highlighted: boolean;
}

export interface WatchContract {
  id: string;
  numero: string | null;
  licitante: string | null;
  titulo: string | null;
  estatus: string | null;
  inicio: string | null;
  fin: string | null;
  importeMin: number | null;
  importeMax: number | null;
  importeMinIva: number | null;
  importeMaxIva: number | null;
  moneda: string | null;
  publicadoAt: string | null;
  /** Partidas a las que el título del contrato hace referencia; vacío = por confirmar en el acta. */
  partidas: number[];
}

export interface WatchSnapshot {
  procedure: string;
  expediente: string;
  capturedAt: string;
  officialUrl: string;
  portalStatus: string | null;
  statusKind: StatusKind;
  /** Moneda del expediente según el portal (descripcion_moneda), p. ej. «PESO MEXICANO». */
  currency: string | null;
  calendar: CalendarSnapshot;
  estimatedContractStart: string | null;
  documents: WatchDocument[];
  docsComplete: boolean;
  partidas: WatchPartida[];
  partidasComplete: boolean;
  partidasReason: string | null;
  contracts: WatchContract[];
  descriptionHash: string;
  technicalFlags: string[];
}

export type WatchEventKind =
  | "fecha_nueva" | "fecha_modificada" | "aviso_calendario" | "bases_anexos" | "acta_junta" | "acta_apertura"
  | "documento_modificado" | "fallo" | "resultado" | "contrato" | "contrato_modificado" | "convenio"
  | "partidas_modificadas" | "descripcion_modificada" | "estatus";

export interface WatchEvent {
  /** Identidad determinista: la misma en el calendario, el watchdog y esta vigilancia. */
  eventId: string;
  kind: WatchEventKind;
  title: string;
  /** Líneas de detalle ya redactadas (HTML escapado se aplica al renderizar). */
  details: string[];
  highlighted: boolean;
  documentId?: string;
  documentUrl?: string;
}

export interface OutboxEntry {
  eventId: string;
  kind: WatchEventKind;
  text: string;
  url: string | null;
  createdAt: string;
  state: "pending" | "sending" | "sent" | "dead";
  attempts: number;
  nextAttemptAt: string | null;
  sendingAt: string | null;
  sentAt: string | null;
  messageId: number | null;
  lastError: string | null;
  /** La entrega anterior no pudo confirmarse (reinicio o tiempo agotado): se reenvía marcada. */
  uncertain: boolean;
}
