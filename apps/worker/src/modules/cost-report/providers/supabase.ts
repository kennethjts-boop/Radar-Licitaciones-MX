/**
 * Supabase — la factura es mensual por organización (plan Pro, 2 proyectos),
 * pero el cómputo se cobra POR PROYECTO y POR HORA (docs Supabase "Manage
 * Compute usage", consultada 2026-10-24). Eso sí es atribuible a Radar:
 *   horas del día (24; el día MX 06:00Z→06:00Z cae en horas completas)
 *   × tarifa horaria del tamaño de cómputo del proyecto Radar.
 * El tamaño no se adivina: lo declara el dueño en SUPABASE_COMPUTE_SIZE
 * (panel → Project Settings → Compute and Disk). Es una estimación bruta:
 * los créditos de cómputo (US$10/mes) y el plan Pro (US$25/mes) son de la
 * organización y no se reparten entre proyectos.
 * Disco, egreso y almacenamiento del proyecto: sólo en la página Usage de la
 * organización filtrando el proyecto (sin API sin token de cuenta).
 */
import type { ProviderLine } from "../types";

export const SUPABASE_PRICING_CHECKED_AT = "2026-10-24";

/** USD por hora. En organizaciones de pago, Nano se cobra como Micro. */
const COMPUTE_HOURLY_USD: Record<string, number> = {
  nano: 0.01344,
  micro: 0.01344,
  small: 0.0206,
  medium: 0.0822,
  large: 0.1517,
  xl: 0.2877,
  "2xl": 0.562,
  "4xl": 1.32,
  "8xl": 2.562,
  "12xl": 3.836,
  "16xl": 5.12,
};

const HOURS_PER_DAY = 24;

export const SUPABASE_SHARED_NOTE =
  "Supabase compartido: plan Pro (US$25/mes) y créditos de cómputo (US$10/mes) son de la organización (2 proyectos); no se atribuyen";
export const SUPABASE_USAGE_PENDING =
  "Supabase disco/egreso del proyecto: Usage de la organización filtrando Radar (basta rol Developer); sin API salvo token de cuenta";

export function supabaseLine(computeSize?: string): ProviderLine {
  const size = computeSize?.trim().toLowerCase();
  const hourly = size ? COMPUTE_HOURLY_USD[size] : undefined;
  const line: ProviderLine = {
    provider: "supabase",
    reportedUsd: null,
    estimatedUsd: null,
    coverage: { status: "not_applicable" },
    missing: [SUPABASE_SHARED_NOTE, SUPABASE_USAGE_PENDING],
  };
  if (hourly === undefined) {
    line.missing.unshift(
      size
        ? `Supabase cómputo: SUPABASE_COMPUTE_SIZE="${size}" no reconocido; no se estima`
        : "Supabase cómputo: declara SUPABASE_COMPUTE_SIZE (Project Settings → Compute and Disk) para estimar el cómputo del proyecto",
    );
    return line;
  }
  line.estimatedUsd = HOURS_PER_DAY * hourly;
  line.estimateDetail = `cómputo del proyecto: ${HOURS_PER_DAY} h × US$${hourly}/h, ${size} declarado, proyecto activo todo el día; bruto, sin créditos de la organización`;
  line.metricsDetail = `${HOURS_PER_DAY} h de cómputo ${size}`;
  return line;
}
