/**
 * OpenAI — gasto real vía Costs API (GET /v1/organization/costs).
 * Requiere una Admin key (sk-admin-…), distinta de la clave de inferencia.
 * La API sólo agrupa por día UTC (bucket_width=1d): no cubre exactamente el
 * día MX (desfase de 6 h), así que se muestra como referencia y nunca entra
 * al total confirmado. Sin OPENAI_PROJECT_ID es gasto de la organización
 * completa: no atribuible a Radar.
 */
import type { ProviderLine } from "../types";
import type { ProviderContext } from "./context";

const COSTS_URL = "https://api.openai.com/v1/organization/costs";

interface CostsResponse {
  data?: Array<{
    start_time: number;
    results?: Array<{ amount?: { value?: number; currency?: string }; project_id?: string | null }>;
  }>;
}

export async function collectOpenAi(ctx: ProviderContext, aiEstimatedUsd: number | null): Promise<ProviderLine> {
  const line: ProviderLine = {
    provider: "openai",
    reportedUsd: null,
    estimatedUsd: aiEstimatedUsd,
    estimateDetail: aiEstimatedUsd !== null ? "registro Radar × tarifa pública" : undefined,
    missing: [],
  };

  const adminKey = ctx.env.OPENAI_ADMIN_KEY?.trim();
  if (!adminKey) {
    line.missing.push(
      "OpenAI gasto real: falta OPENAI_ADMIN_KEY (Admin key de la organización con alcance de lectura de Usage; la clave de inferencia no sirve)",
    );
    return line;
  }

  const utcStart = Date.UTC(
    Number(ctx.date.slice(0, 4)),
    Number(ctx.date.slice(5, 7)) - 1,
    Number(ctx.date.slice(8, 10)),
  ) / 1000;
  const projectId = ctx.env.OPENAI_PROJECT_ID?.trim();
  const params = new URLSearchParams({
    start_time: String(utcStart),
    end_time: String(utcStart + 86_400),
    bucket_width: "1d",
    limit: "1",
  });
  if (projectId) params.append("project_ids", projectId);

  try {
    const res = await ctx.fetch(`${COSTS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${adminKey}` },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    if (!res.ok) {
      line.missing.push(`OpenAI Costs API respondió HTTP ${res.status}${res.status === 401 || res.status === 403 ? " (la clave no es Admin key o le falta lectura de Usage)" : ""}`);
      return line;
    }
    const body = (await res.json()) as CostsResponse;
    const results = body.data?.[0]?.results ?? [];
    if (results.length === 0) {
      line.missing.push(`OpenAI Costs API aún sin datos para el día UTC ${ctx.date} (posible retraso del proveedor)`);
      return line;
    }
    const nonUsd = results.some((r) => (r.amount?.currency ?? "usd").toLowerCase() !== "usd");
    if (nonUsd) {
      line.missing.push("OpenAI Costs API devolvió una moneda distinta de USD; no se convierte");
      return line;
    }
    const usd = results.reduce((sum, r) => sum + (r.amount?.value ?? 0), 0);
    line.reference = {
      usd,
      period: `día UTC ${ctx.date} (desfase 6 h vs día MX)`,
      reason: projectId ? "proyecto OpenAI configurado" : "organización completa, no atribuible a Radar",
    };
  } catch (err) {
    line.missing.push(`OpenAI Costs API no respondió (${err instanceof Error ? err.name : "error"})`);
  }
  return line;
}
