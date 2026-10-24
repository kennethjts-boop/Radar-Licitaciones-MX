/**
 * OpenAI — gasto real vía Costs API (GET /v1/organization/costs).
 * Requiere una Admin key (sk-admin-…), distinta de la clave de inferencia.
 * La API sólo agrupa por día UTC (bucket_width=1d): no cubre exactamente el
 * día MX (desfase de 6 h), así que se muestra como referencia y nunca entra
 * al total confirmado. Sin OPENAI_PROJECT_ID es gasto de la organización
 * completa: no atribuible a Radar.
 *
 * Contraste de consumo: Usage API (/v1/organization/usage/completions y
 * /embeddings) admite buckets de 1 h, así que cubre el día MX exacto
 * (06:00Z → 06:00Z) por modelo y, con OPENAI_PROJECT_ID, sólo el proyecto
 * de Radar. Se compara contra los tokens que Radar registró.
 */
import type { AiModelStats, ProviderLine } from "../types";
import type { ProviderContext } from "./context";

const COSTS_URL = "https://api.openai.com/v1/organization/costs";
const USAGE_URLS = [
  "https://api.openai.com/v1/organization/usage/completions",
  "https://api.openai.com/v1/organization/usage/embeddings",
];
const MAX_USAGE_PAGES = 4;

export interface ModelUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

interface UsageResponse {
  data?: Array<{
    results?: Array<{
      model?: string | null;
      input_tokens?: number;
      output_tokens?: number;
      num_model_requests?: number;
    }>;
  }>;
  has_more?: boolean;
  next_page?: string | null;
}

/** Suma por modelo de la Usage API en [startUtc, endUtc), buckets de 1 h. */
export async function fetchOpenAiUsage(
  ctx: ProviderContext,
  adminKey: string,
  projectId?: string,
): Promise<Map<string, ModelUsage>> {
  const out = new Map<string, ModelUsage>();
  for (const url of USAGE_URLS) {
    let page: string | null | undefined;
    for (let i = 0; i < MAX_USAGE_PAGES; i++) {
      const params = new URLSearchParams({
        start_time: String(Math.floor(ctx.startUtc.getTime() / 1000)),
        end_time: String(Math.floor(ctx.endUtc.getTime() / 1000)),
        bucket_width: "1h",
        group_by: "model",
        limit: "24",
      });
      if (projectId) params.append("project_ids", projectId);
      if (page) params.set("page", page);
      const res = await ctx.fetch(`${url}?${params}`, {
        headers: { Authorization: `Bearer ${adminKey}` },
        signal: AbortSignal.timeout(ctx.timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as UsageResponse;
      for (const bucket of body.data ?? []) {
        for (const r of bucket.results ?? []) {
          const model = (r.model ?? "desconocido").toLowerCase();
          const m = out.get(model) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
          m.requests += r.num_model_requests ?? 0;
          m.inputTokens += r.input_tokens ?? 0;
          m.outputTokens += r.output_tokens ?? 0;
          out.set(model, m);
        }
      }
      if (!body.has_more || !body.next_page) break;
      page = body.next_page;
    }
  }
  return out;
}

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${compact(Math.abs(n))}`;

/**
 * Texto de contraste OpenAI vs registro Radar. Solicitudes Radar = respuestas
 * correctas (la Usage API no cuenta solicitudes rechazadas).
 */
export function openAiReconciliation(api: Map<string, ModelUsage>, radar: AiModelStats[], scope: string): string {
  const sum = (xs: ModelUsage[]) =>
    xs.reduce((a, m) => ({ requests: a.requests + m.requests, inputTokens: a.inputTokens + m.inputTokens, outputTokens: a.outputTokens + m.outputTokens }),
      { requests: 0, inputTokens: 0, outputTokens: 0 });
  const a = sum([...api.values()]);
  const r = sum(
    radar
      .filter((m) => m.provider === "openai")
      .map((m) => ({ requests: m.requests - m.errors, inputTokens: m.inputTokens, outputTokens: m.outputTokens })),
  );
  return [
    `Usage API OpenAI (${scope}, día MX exacto): ${compact(a.requests)} sol · ${compact(a.inputTokens)}/${compact(a.outputTokens)} tok`,
    `registro Radar: ${compact(r.requests)} sol · ${compact(r.inputTokens)}/${compact(r.outputTokens)} tok`,
    `diferencia ${signed(a.requests - r.requests)} sol · ${signed(a.inputTokens - r.inputTokens)}/${signed(a.outputTokens - r.outputTokens)} tok`,
  ].join(" · ");
}

interface CostsResponse {
  data?: Array<{
    start_time: number;
    results?: Array<{ amount?: { value?: number; currency?: string }; project_id?: string | null }>;
  }>;
}

export async function collectOpenAi(
  ctx: ProviderContext,
  aiEstimatedUsd: number | null,
  radarModels: AiModelStats[] | null = null,
): Promise<ProviderLine> {
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
      "OpenAI gasto real y contraste: falta OPENAI_ADMIN_KEY (Admin key de la organización, la crea un Owner; el worker sólo lee /organization/usage y /organization/costs; la clave de inferencia no sirve)",
    );
    return line;
  }

  const utcStart = Date.UTC(
    Number(ctx.date.slice(0, 4)),
    Number(ctx.date.slice(5, 7)) - 1,
    Number(ctx.date.slice(8, 10)),
  ) / 1000;
  const projectId = ctx.env.OPENAI_PROJECT_ID?.trim();
  if (!projectId) {
    line.missing.push("OpenAI atribución: falta OPENAI_PROJECT_ID (proyecto dedicado a Radar); sin él, uso y gasto son de toda la organización");
  }
  if (radarModels) {
    try {
      const api = await fetchOpenAiUsage(ctx, adminKey, projectId);
      line.reconciliation = openAiReconciliation(api, radarModels, projectId ? "proyecto Radar" : "organización completa");
    } catch (err) {
      line.missing.push(`OpenAI Usage API no disponible (${err instanceof Error ? err.message : "error"}); sin contraste de tokens`);
    }
  }
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
