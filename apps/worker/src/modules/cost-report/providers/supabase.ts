/**
 * Supabase — la facturación es mensual por organización y suma todos sus
 * proyectos; no hay API de costo diario. La organización de Radar (plan
 * Pro) contiene más de un proyecto, por lo que el gasto no es atribuible a
 * Radar. No se estima ni se reporta como $0.
 */
import type { ProviderLine } from "../types";

export function supabaseLine(): ProviderLine {
  return {
    provider: "supabase",
    reportedUsd: null,
    estimatedUsd: null,
    missing: [
      "Supabase: sin costo diario por API (factura mensual por organización con varios proyectos); no atribuible a Radar",
    ],
  };
}
