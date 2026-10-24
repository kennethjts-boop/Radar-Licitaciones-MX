/**
 * Tarifas públicas en USD por 1M de tokens (precio estándar, sin caché ni
 * batch). Se usan sólo para ESTIMAR; nunca se presentan como gasto real.
 *
 * verified=true: tomada de la página oficial del modelo en
 * developers.openai.com/api/docs/models/<modelo> (consultada 2026-10-24).
 * verified=false: sólo confirmada en agregadores; el reporte lo indica.
 * Hoy todas las entradas están verificadas en la fuente oficial.
 * Modelos sin entrada → costo no estimado ("sin tarifa").
 */
export const PRICING_CHECKED_AT = "2026-10-24";

interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
  verified: boolean;
}

const OPENAI_PRICES: Record<string, ModelPrice> = {
  "gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6, verified: true },
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10, verified: true },
  "text-embedding-3-small": { inputPerM: 0.02, outputPerM: 0, verified: true },
  "gpt-4.1-mini": { inputPerM: 0.4, outputPerM: 1.6, verified: true },
};

/** "openai/gpt-4o-mini" → "gpt-4o-mini"; quita sufijos de fecha "-2024-07-18". */
export function normalizeModelId(model: string): string {
  const base = model.trim().toLowerCase().replace(/^openai\//, "");
  return base.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

export function isFreeModel(model: string): boolean {
  return /:free$/i.test(model.trim());
}

export interface PriceLookup {
  usd: number | null;
  verified: boolean;
}

export function estimateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): PriceLookup {
  if (isFreeModel(model)) return { usd: 0, verified: true };
  const price = OPENAI_PRICES[normalizeModelId(model)];
  if (!price) return { usd: null, verified: false };
  const usd =
    (inputTokens * price.inputPerM + outputTokens * price.outputPerM) / 1_000_000;
  return { usd, verified: price.verified };
}
