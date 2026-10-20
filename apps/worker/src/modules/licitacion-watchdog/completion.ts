/**
 * COMPLETION — detección de expedientes que ya no deben seguir vigilados.
 *
 * Un target del watchdog permanece activo hasta que alguien ejecuta
 * `/novigilar`. Sin este módulo, un expediente desierto o cancelado seguía
 * consultándose en cada ciclo del watchdog (navegación, extracción y
 * consumo de navegador) indefinidamente, sin aportar información nueva.
 *
 * Criterio conservador: sólo se retiran los estados en los que el
 * procedimiento es definitivamente nulo. Un fallo o una adjudicación NO
 * retiran la vigilancia, porque después del fallo se publican el contrato
 * y sus anexos, y esos documentos son exactamente lo que el operador quiere
 * detectar.
 */
import type { JsonObject, WatchdogSnapshot } from "./types";

export type WatchdogCompletionKind = "desierta" | "cancelada" | "anulada";

export interface WatchdogCompletion extends JsonObject {
  /** Estatus tal como lo publica el portal. */
  status: string;
  kind: WatchdogCompletionKind;
}

const STATUS_FIELD = "Estatus del procedimiento de contratación";

/**
 * Estatus que terminan el procedimiento de forma definitiva.
 *
 * Coincidencia EXACTA sobre el texto normalizado (mayúsculas, sin acentos ni
 * puntuación): nunca por subcadena. Así no retiran la vigilancia variantes
 * ambiguas o negadas como "NO DESIERTA", "DESIERTA PARCIALMENTE",
 * "PARTIDAS DESIERTAS", "CANCELACION EN REVISION" o "ADJUDICADA (CANCELADA
 * PARTIDA 2)". Un estatus desconocido nunca retira: sólo deja de vigilarse lo
 * que el portal declara nulo sin matices.
 */
const TERMINAL_STATUSES: ReadonlyMap<string, WatchdogCompletionKind> = new Map([
  ["DESIERTA", "desierta"],
  ["DESIERTO", "desierta"],
  ["DECLARADA DESIERTA", "desierta"],
  ["DECLARADO DESIERTO", "desierta"],
  ["PROCEDIMIENTO DESIERTO", "desierta"],
  ["LICITACION DESIERTA", "desierta"],
  ["CANCELADA", "cancelada"],
  ["CANCELADO", "cancelada"],
  ["PROCEDIMIENTO CANCELADO", "cancelada"],
  ["LICITACION CANCELADA", "cancelada"],
  ["ANULADA", "anulada"],
  ["ANULADO", "anulada"],
  ["PROCEDIMIENTO ANULADO", "anulada"],
  ["LICITACION ANULADA", "anulada"],
]);

function normalizeStatus(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!]+$/, "")
    .trim();
}

/**
 * Lee el estatus del procedimiento de contratación de un snapshot verificado.
 * Devuelve `null` cuando el portal no expone el campo; en ese caso no se
 * toma ninguna decisión (nunca se retira un objetivo por falta de dato).
 */
export function readProcedureStatus(snapshot: WatchdogSnapshot): string | null {
  const fields = snapshot.visibleFields ?? {};
  const raw = fields[STATUS_FIELD];
  // Varios valores distintos para el mismo campo son ambiguos: no se decide.
  const values = (Array.isArray(raw) ? raw : [raw])
    .filter((value): value is string => typeof value === "string")
    .map(normalizeStatus)
    .filter((value) => value.length > 0);
  const distinct = Array.from(new Set(values));
  return distinct.length === 1 ? distinct[0] : null;
}

/**
 * Clasifica el estatus del procedimiento.
 * Devuelve `null` si el procedimiento sigue vigente o si el estatus no es
 * concluyente.
 */
export function detectProcedureCompletion(
  snapshot: WatchdogSnapshot,
): WatchdogCompletion | null {
  const status = readProcedureStatus(snapshot);
  if (!status) return null;
  const kind = TERMINAL_STATUSES.get(status);
  return kind ? { status, kind } : null;
}

/**
 * El estatus proviene del portal (texto remoto) y el alias puede contener
 * caracteres de la descripción de la dependencia: ambos se escapan antes de
 * incrustarse en HTML de Telegram.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Mensaje neutro para el operador cuando la vigilancia de un expediente
 * termina por estado del procedimiento.
 */
export function formatCompletionMessage(
  alias: string,
  numeroProcedimiento: string,
  completion: WatchdogCompletion,
  expedienteUrl: string,
): string {
  const motivo: Record<WatchdogCompletionKind, string> = {
    desierta: "El procedimiento fue declarado desierto.",
    cancelada: "El procedimiento fue cancelado.",
    anulada: "El procedimiento fue anulado.",
  };
  return [
    `✅ <b>Watchdog finalizado — ${escapeHtml(alias)}</b>`,
    `Procedimiento: <code>${escapeHtml(numeroProcedimiento)}</code>`,
    `Estatus en el portal: <b>${escapeHtml(completion.status)}</b>`,
    motivo[completion.kind],
    "<i>El expediente ya no se vigilará. La historia y los cambios detectados se conservan.</i>",
    `<a href="${escapeHtml(expedienteUrl)}">Ver expediente en ComprasMX</a>`,
  ]
    .filter(Boolean)
    .join("\n");
}
