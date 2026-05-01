/**
 * TOPES FINANCIEROS — Tipos para el motor de evaluación de modalidades.
 * Fuente: PEF 2026 Anexo 9, artículos 43 LAASSP y 43 LOPSRM.
 */

export type TipoContratacion = "adquisicion" | "arrendamiento" | "obra_publica";

export type ModalidadContratacion =
  | "adjudicacion_directa"
  | "invitacion_tres_personas"
  | "licitacion_publica";

/** Fila de la tabla topes_financieros_federales */
export interface TopeFinancieroRow {
  id: string;
  anio: number;
  tipo: TipoContratacion;
  presupuesto_desde: number;
  presupuesto_hasta: number | null;
  tope_adjudicacion_miles: number;
  tope_invitacion_miles: number;
  fuente: string;
}

export interface EvaluarModalidadParams {
  /** Monto del contrato en pesos MXN */
  monto: number;
  tipo: TipoContratacion;
  /** Presupuesto autorizado de la entidad en pesos MXN.
   *  Usar 500_000_000 como default si no se conoce. */
  presupuestoAutorizado: number;
  /** Año fiscal. Default: año actual. */
  anio?: number;
  /** Si true, divide monto / 1.16 antes de comparar con topes. Default: false. */
  incluyeIva?: boolean;
}

export interface EvaluarModalidadResult {
  modalidad: ModalidadContratacion;
  /** Monto sin IVA (igual a monto si incluyeIva=false) */
  montoSinIva: number;
  /** Tope de adjudicación directa en pesos MXN */
  topeAdjudicacion: number;
  /** Tope de invitación a 3 personas en pesos MXN */
  topeInvitacion: number;
  /** Explicación en español */
  analisis: string;
}
