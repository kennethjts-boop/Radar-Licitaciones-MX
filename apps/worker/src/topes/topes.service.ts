/**
 * TOPES FINANCIEROS — Motor de evaluación de modalidad de contratación.
 * Fuente: PEF 2026 Anexo 9, artículos 43 LAASSP y 43 LOPSRM.
 */
import { createModuleLogger } from "../core/logger";
import { getSupabaseClient } from "../storage/client";
import { StorageError } from "../core/errors";
import type { NormalizedProcurement } from "../types/procurement";
import type {
  TipoContratacion,
  ModalidadContratacion,
  TopeFinancieroRow,
  EvaluarModalidadParams,
  EvaluarModalidadResult,
} from "./topes.types";

const log = createModuleLogger("topes-service");

const IVA = 1.16;

// ── Inferencia de tipo de contratación ───────────────────────────────────────

const ARRENDAMIENTO_KEYWORDS = ["arrendamiento"];

const OBRA_KEYWORDS = [
  "obra publica",
  "obra pública",
  "construccion",
  "construcción",
  "rehabilitacion",
  "rehabilitación",
  "ampliacion",
  "ampliación",
  "proyecto ejecutivo",
  "infraestructura",
  "carretera",
  "pavimentacion",
  "pavimentación",
  "drenaje",
  "alcantarillado",
];

/**
 * Infiere TipoContratacion a partir del texto canónico del expediente.
 * Arrendamiento tiene precedencia sobre obra pública.
 * Default: "adquisicion".
 */
export function inferTipoContratacion(
  procurement: NormalizedProcurement,
): TipoContratacion {
  const text = procurement.canonicalText.toLowerCase();
  if (ARRENDAMIENTO_KEYWORDS.some((k) => text.includes(k))) {
    return "arrendamiento";
  }
  if (OBRA_KEYWORDS.some((k) => text.includes(k))) {
    return "obra_publica";
  }
  return "adquisicion";
}

// ── Lógica pura de cálculo ───────────────────────────────────────────────────

interface TopesInput {
  tipo: TipoContratacion;
  topeAdjudicacion: number; // pesos MXN
  topeInvitacion: number;   // pesos MXN
}

function formatPesos(n: number): string {
  return n.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });
}

/**
 * Función pura: determina la modalidad dados el monto y los topes.
 * No accede a Supabase — completamente testeable.
 */
export function computarModalidad(
  monto: number,
  incluyeIva: boolean,
  topes: TopesInput,
): EvaluarModalidadResult {
  const montoSinIva = incluyeIva ? monto / IVA : monto;

  let modalidad: ModalidadContratacion;
  if (montoSinIva <= topes.topeAdjudicacion) {
    modalidad = "adjudicacion_directa";
  } else if (montoSinIva <= topes.topeInvitacion) {
    modalidad = "invitacion_tres_personas";
  } else {
    modalidad = "licitacion_publica";
  }

  const montoFmt = formatPesos(montoSinIva);
  const adFmt = formatPesos(topes.topeAdjudicacion);
  const i3pFmt = formatPesos(topes.topeInvitacion);
  const tipoLabel = topes.tipo.replace(/_/g, " ");

  const analisisMap: Record<ModalidadContratacion, string> = {
    adjudicacion_directa:
      `El monto de ${montoFmt} no supera el tope de adjudicación directa ` +
      `de ${adFmt} para ${tipoLabel}.`,
    invitacion_tres_personas:
      `El monto de ${montoFmt} supera el tope de adjudicación directa ` +
      `(${adFmt}) pero no el de invitación a 3 personas (${i3pFmt}) ` +
      `para ${tipoLabel}.`,
    licitacion_publica:
      `El monto de ${montoFmt} supera el tope de invitación a 3 personas ` +
      `(${i3pFmt}) para ${tipoLabel}, por lo que requiere licitación pública.`,
  };

  return {
    modalidad,
    montoSinIva,
    topeAdjudicacion: topes.topeAdjudicacion,
    topeInvitacion: topes.topeInvitacion,
    analisis: analisisMap[modalidad],
  };
}

// ── Consulta Supabase ─────────────────────────────────────────────────────────

/**
 * Devuelve la fila de topes que aplica para (anio, tipo, presupuestoAutorizado).
 * Selecciona el rango de presupuesto más alto que no supere el presupuesto dado.
 * @throws StorageError si no se encuentran datos para los parámetros dados.
 */
export async function consultarTopes(
  anio: number,
  tipo: TipoContratacion,
  presupuestoAutorizado: number,
): Promise<TopeFinancieroRow> {
  const db = getSupabaseClient();

  const { data, error } = await db
    .from("topes_financieros_federales")
    .select("*")
    .eq("anio", anio)
    .eq("tipo", tipo)
    .lte("presupuesto_desde", presupuestoAutorizado)
    .order("presupuesto_desde", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    log.warn(
      { anio, tipo, presupuestoAutorizado, err: error.message },
      "Error consultando topes financieros",
    );
    throw new StorageError(
      `No se encontraron topes para anio=${anio}, tipo=${tipo}: ${error.message}`,
      "consultar_topes",
    );
  }

  return data as TopeFinancieroRow;
}

// ── Función compuesta ─────────────────────────────────────────────────────────

/**
 * Evalúa la modalidad de contratación probable para un contrato.
 * Combina consulta Supabase + lógica pura de cálculo.
 */
export async function evaluarModalidad(
  params: EvaluarModalidadParams,
): Promise<EvaluarModalidadResult> {
  const anio = params.anio ?? new Date().getFullYear();

  const tope = await consultarTopes(
    anio,
    params.tipo,
    params.presupuestoAutorizado,
  );

  return computarModalidad(params.monto, params.incluyeIva ?? false, {
    tipo: params.tipo,
    topeAdjudicacion: tope.tope_adjudicacion_miles * 1000,
    topeInvitacion: tope.tope_invitacion_miles * 1000,
  });
}
