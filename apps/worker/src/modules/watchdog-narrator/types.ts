import type { WatchdogChange } from "../licitacion-watchdog/types";

export type ClassifierCategory =
  | "cambio_estatus"
  | "fecha_apertura"
  | "fecha_junta"
  | "fecha_fallo"
  | "documento_nuevo"
  | "tabla_modificada"
  | "desconocido";

export interface NarrativeInput {
  alias: string;
  expedienteUrl: string;
  changes: WatchdogChange[];
}

export interface RenderedNarrative {
  text: string;
  category: ClassifierCategory;
}
