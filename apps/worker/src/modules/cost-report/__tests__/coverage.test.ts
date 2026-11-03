import OpenAI from "openai";
import { resetConfig } from "../../../config/env";
import { generateAiNarrativeSections } from "../../watchdog-narrator/ai-narrator";
import {
  aggregateAiUsage,
  buildUsageRow,
  createUsageRecorder,
  isMissingOptionalColumn,
  keyFingerprint,
  observedFetch,
  setAiUsageSinkForTests,
  trackAiCall,
  type AiUsageInput,
  type AiUsageRow,
  type UsageRow,
} from "../ai-usage";
import { compareMetrics, computeTotals } from "../analysis";
import { classifyCoverage, COVERAGE_KEY, ensureCoverageMarker, gapKey } from "../coverage";
import { formatCostReport } from "../format";
import { collectDayMetrics, resetDeliveryGuardForTests, runDailyCostReport } from "../job";
import { mexicoDayBounds } from "../period";
import { fetchOpenAiUsage, openAiReconciliation } from "../providers/openai";
import { openRouterReconciliation, type OpenRouterDelta } from "../providers/openrouter";
import { supabaseLine } from "../providers/supabase";
import { reportKey, type StateStore } from "../report-state";
import type { DayCostMetrics, DayCoverage, ProviderLine } from "../types";

function memoryStore(): StateStore & { data: Map<string, any> } {
  const data = new Map<string, any>();
  return {
    data,
    insertIfAbsent: async (k, v) => (data.has(k) ? false : (data.set(k, structuredClone(v)), true)),
    read: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null),
    readMany: async (keys) => new Map(keys.filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))])),
    compareAndSet: async () => false,
    write: async (k, v) => void data.set(k, structuredClone(v)),
  };
}

// Instalación real: el worker con medición arrancó el 23/10 a las 19:46 CDMX.
const INSTALL = "2026-10-24T01:46:00.000Z";
const marker = { since: INSTALL, version: 2 };
const noFetch = (async () => {
  throw new Error("sin red en pruebas");
}) as unknown as typeof fetch;
const thresholds = { pct: 50, minUsd: 1, minDays: 3, minRequests: 20, minErrors: 5 };

describe("cobertura de la medición", () => {
  it("clasifica días sin cobertura, parciales y completos", () => {
    expect(classifyCoverage("2026-10-22", marker, null).status).toBe("none");
    expect(classifyCoverage("2026-10-23", marker, null)).toMatchObject({ status: "partial", sinceWithinDay: true });
    expect(classifyCoverage("2026-10-24", marker, null).status).toBe("complete");
    expect(classifyCoverage("2026-10-24", marker, { droppedEvents: 2, updatedAt: "" })).toMatchObject({
      status: "partial",
      droppedEvents: 2,
    });
    expect(classifyCoverage("2026-10-24", null, null)).toMatchObject({ status: "none", since: null });
  });

  it("el marcador se escribe una vez y sólo si la tabla responde", async () => {
    const store = memoryStore();
    expect(await ensureCoverageMarker(store, async () => false, "A", new Date(INSTALL))).toBeNull();
    expect(store.data.has(COVERAGE_KEY)).toBe(false);
    await ensureCoverageMarker(store, async () => true, "A", new Date(INSTALL));
    const later = await ensureCoverageMarker(store, async () => true, "B", new Date("2026-10-30T00:00:00Z"));
    expect(later).toMatchObject({ since: INSTALL, instanceId: "A" });
  });

  it("día anterior a la instalación: sin datos, nunca US$0.00, sin consultar eventos", async () => {
    const store = memoryStore();
    store.data.set(COVERAGE_KEY, marker);
    const readRows = jest.fn(async () => [] as AiUsageRow[]);
    const m = await collectDayMetrics("2026-10-22", store, noFetch, readRows);
    expect(m.coverage?.status).toBe("none");
    expect(m.ai).toBeNull();
    expect(readRows).not.toHaveBeenCalled();
    for (const p of ["openai", "openrouter"]) {
      const line = m.providers.find((l) => l.provider === p)!;
      expect(line.estimatedUsd).toBeNull();
      expect(line.coverage?.status).toBe("none");
    }
    expect(m.totals.estimatedProviders).not.toContain("openai");
    const text = formatCostReport(m, compareMetrics(m, []), { generatedAt: new Date(INSTALL), thresholds });
    expect(text).toContain("sin datos: la medición confiable empezó 23/10/2026 19:46 CDMX");
    expect(text).not.toContain("US$0.00");
    expect(text).not.toContain("0 solicitudes registradas");
  });

  it("sin marcador (tabla o worker pendiente): sin datos aunque haya 0 filas", async () => {
    const m = await collectDayMetrics("2026-10-24", memoryStore(), noFetch, async () => []);
    expect(m.coverage).toMatchObject({ status: "none", since: null });
    expect(m.providers.find((l) => l.provider === "openai")!.estimatedUsd).toBeNull();
  });

  it("día de instalación: medición parcial, con valores pero etiquetados", async () => {
    const store = memoryStore();
    store.data.set(COVERAGE_KEY, marker);
    const rows: AiUsageRow[] = [
      { provider: "openai", model: "gpt-4o-mini", status: "ok", attempt: 1, input_tokens: 1000, output_tokens: 100, cost_reported_usd: null, cost_estimated_usd: 0.00021, error_kind: null, http_attempts: 1 },
    ];
    const m = await collectDayMetrics("2026-10-23", store, noFetch, async () => rows);
    expect(m.coverage?.status).toBe("partial");
    expect(m.providers[0].estimatedUsd).toBeCloseTo(0.00021);
    expect(m.totals.estimatePartial).toEqual(["openai", "openrouter"]);
    const text = formatCostReport(m, compareMetrics(m, []), { generatedAt: new Date(INSTALL), thresholds });
    expect(text).toContain("medición parcial: desde 23/10/2026 19:46 CDMX");
    expect(text).toContain("Métricas de IA sin comparar");
  });

  it("parciales y reportes sin cobertura no entran a promedios ni anomalías", () => {
    const mk = (date: string, usd: number, coverage?: DayCoverage, confirmed: number | null = null): DayCostMetrics => {
      const providers: ProviderLine[] = [
        { provider: "openai", reportedUsd: null, estimatedUsd: usd, missing: [] },
        { provider: "openrouter", reportedUsd: confirmed, estimatedUsd: null, missing: [] },
      ];
      const b = mexicoDayBounds(date);
      return {
        date,
        periodStartUtc: b.startUtc.toISOString(),
        periodEndUtc: b.endUtc.toISOString(),
        providers,
        ai: aggregateAiUsage([]),
        totals: computeTotals(providers),
        coverage,
      };
    };
    const complete: DayCoverage = { status: "complete", since: "2026-10-01T00:00:00Z", droppedEvents: 0 };
    const partial: DayCoverage = { status: "partial", since: "2026-10-20T20:00:00Z", droppedEvents: 0 };
    // Legado (22/10, US$0 sin cobertura) y parcial (20/10) quedan fuera.
    const history = [mk("2026-10-22", 0, undefined, 1), mk("2026-10-21", 1, complete, 1), mk("2026-10-20", 9, partial, 1)];
    const c = compareMetrics(mk("2026-10-23", 3, complete, 1), history, thresholds);
    const est = c.find((x) => x.key === "openai.estimated")!;
    expect(est).toMatchObject({ sampleDays: 1, average: 1, previous: null, status: "baseline" });
    // El contador de OpenRouter no depende del registro de IA: sí se compara.
    expect(c.find((x) => x.key === "openrouter.reported")!.sampleDays).toBe(3);
    // Día actual parcial: ninguna métrica de IA se compara.
    const cp = compareMetrics(mk("2026-10-23", 3, partial, 1), history, thresholds);
    expect(cp.map((x) => x.key)).toEqual(["total.confirmed", "openrouter.reported"]);
  });

  it("reporte de las 08:00 de un día previo a la instalación dice 'sin datos'", async () => {
    resetDeliveryGuardForTests();
    const store = memoryStore();
    store.data.set(COVERAGE_KEY, marker);
    const send = jest.fn(async (_text: string) => ({ messageId: 1 }));
    // 08:00 CDMX del 23/10 → reporta el 22/10.
    await runDailyCostReport({ store, now: new Date("2026-10-23T14:00:00Z"), fetchImpl: noFetch, send, resolveChat: async () => "1" });
    const text = send.mock.calls[0][0];
    expect(text).toContain("Gastos del 22/10/2026");
    expect(text).toContain("sin datos");
    expect(text).not.toMatch(/OpenAI<\/b>[\s\S]*?costo: estimado US\$0\.00/);
    expect(store.data.get(reportKey("2026-10-22")).metrics.coverage.status).toBe("none");
  });
});

describe("instrumentación de llamadas", () => {
  const captured: AiUsageInput[] = [];
  beforeEach(() => {
    captured.length = 0;
    setAiUsageSinkForTests((i) => captured.push(i));
  });
  afterEach(() => {
    setAiUsageSinkForTests(null);
    jest.restoreAllMocks();
  });

  it("cuenta reintentos internos reales del SDK de OpenAI", async () => {
    const spy = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 500, headers: { "retry-after-ms": "1" } }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "x", object: "chat.completion", created: 0, model: "gpt-4o-mini", choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const client = new OpenAI({ apiKey: "sk-prueba", fetch: observedFetch });
    await trackAiCall({ provider: "openai", model: "gpt-4o-mini", operation: "analyze_tender", keyId: keyFingerprint("sk-prueba") }, () =>
      client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hola" }] }),
    );
    expect(spy).toHaveBeenCalledTimes(2);
    expect(captured).toEqual([expect.objectContaining({ status: "ok", httpAttempts: 2, inputTokens: 10, outputTokens: 2 })]);
    expect(captured[0].keyId).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(JSON.stringify(captured)).not.toContain("sk-prueba");
  });

  it("cliente sin fetch observado: reintentos no medibles (NULL), no 1", async () => {
    await trackAiCall({ provider: "openai", model: "m", operation: "x" }, async () => ({ usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    expect(captured[0].httpAttempts).toBeNull();
    const s = aggregateAiUsage([
      { ...(buildUsageRow({ ...captured[0] }) as unknown as AiUsageRow) },
      { provider: "openai", model: "m", status: "ok", attempt: 1, input_tokens: 1, output_tokens: 1, cost_reported_usd: null, cost_estimated_usd: null, error_kind: null, http_attempts: 3 },
    ]);
    expect(s).toMatchObject({ requests: 2, httpRetries: 2, retriesUnobserved: 1 });
  });

  it("narrador: respuesta 200 ilegible se registra una vez como error", async () => {
    process.env.WATCHDOG_NARRATOR_AI = "true";
    process.env.OPENROUTER_API_KEY = "or-clave-de-prueba";
    resetConfig();
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("no-json", { status: 200 }));
    const out = await generateAiNarrativeSections({ alias: "x", changes: [] } as any, "cambio");
    expect(out).toBeNull();
    expect(captured).toEqual([
      expect.objectContaining({ operation: "watchdog_narrator", status: "error", httpAttempts: 1, errorKind: "parse_error" }),
    ]);
    delete process.env.WATCHDOG_NARRATOR_AI;
    delete process.env.OPENROUTER_API_KEY;
    resetConfig();
  });
});

describe("registro con reintento y huecos", () => {
  const row = (iso: string): UsageRow => buildUsageRow({ provider: "openai", model: "m", operation: "x", status: "ok" }, new Date(iso));

  it("reintenta filas fallidas y, al agotarse, anota el hueco del día MX", async () => {
    let fail = true;
    const inserted: UsageRow[] = [];
    const gaps: Array<[string, number]> = [];
    const rec = createUsageRecorder({
      insert: async (rows) => (fail ? "db caída" : (inserted.push(...rows), null)),
      addGap: async (d, n) => void gaps.push([d, n]),
      schedule: () => undefined,
      maxTries: 2,
    });
    await rec.record(row("2026-10-24T05:59:00Z")); // 23/10 23:59 CDMX
    expect(rec.pendingCount()).toBe(1);
    await rec.flush(); // segundo intento fallido → se agota
    expect(rec.pendingCount()).toBe(0);
    expect(gaps).toEqual([["2026-10-23", 1]]);

    await rec.record(row("2026-10-24T12:00:00Z"));
    fail = false;
    await rec.flush();
    expect(inserted).toHaveLength(1);
    expect(rec.droppedByDate().size).toBe(0);
  });

  it("detecta columnas opcionales faltantes (migración pendiente)", () => {
    expect(isMissingOptionalColumn({ code: "PGRST204", message: "Could not find the 'http_attempts' column of 'ai_usage_events'" })).toBe(true);
    expect(isMissingOptionalColumn({ code: "42703", message: "column ai_usage_events.key_id does not exist" })).toBe(true);
    expect(isMissingOptionalColumn({ code: "23514", message: "violates check constraint" })).toBe(false);
  });
});

describe("contraste con proveedores", () => {
  const keyA = keyFingerprint("clave-A");
  const delta: OpenRouterDelta = {
    usd: 0.0105,
    aligned: false,
    periodStart: "2026-10-24T06:00:04.000Z",
    periodEnd: "2026-10-25T09:00:00.000Z",
    keyId: keyA,
  };
  const r = (cost: number | null, key_id: string | undefined, status: "ok" | "error" = "ok"): AiUsageRow => ({
    provider: "openrouter", model: "openai/gpt-4o-mini", status, attempt: 1, input_tokens: 1, output_tokens: 1,
    cost_reported_usd: cost, cost_estimated_usd: null, error_kind: null, key_id,
  });

  it("OpenRouter: misma clave y periodo real; otras claves fuera", () => {
    const text = openRouterReconciliation(delta, [r(0.004, keyA), r(0.006, keyA), r(0.5, keyFingerprint("otra")), r(null, keyA)], INSTALL)!;
    expect(text).toContain(`contador ${keyA} 24/10 00:00:04 → 25/10 03:00:00 CDMX: US$0.0105`);
    expect(text).toContain("respuestas Radar misma clave y periodo: US$0.0100 (3 sol)");
    expect(text).toContain("diferencia US$0.0005");
    expect(text).toContain("1 respuestas sin usage.cost");
    expect(text).toContain("1 sol con otra clave, excluidas");
  });

  it("OpenRouter: sin contraste si la medición no cubre el periodo o faltan huellas", () => {
    expect(openRouterReconciliation(delta, [], "2026-10-24T08:00:00Z")).toContain("no cubre todo ese periodo");
    expect(openRouterReconciliation(delta, [r(0.01, undefined)], INSTALL)).toContain("migración 20261025 pendiente");
  });

  it("OpenAI Usage API: día MX exacto en buckets de 1 h, por proyecto y paginado", async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      const page2 = url.includes("page=p2");
      const body = url.includes("/completions") && !page2
        ? { data: [{ results: [{ model: "gpt-4o-mini-2024-07-18", input_tokens: 900, output_tokens: 90, num_model_requests: 3 }] }], has_more: true, next_page: "p2" }
        : { data: [{ results: [{ model: url.includes("/embeddings") ? "text-embedding-3-small" : "gpt-4o-mini-2024-07-18", input_tokens: 100, output_tokens: 10, num_model_requests: 1 }] }], has_more: false };
      return { ok: true, json: async () => body };
    }) as unknown as typeof fetch;
    const b = mexicoDayBounds("2026-10-24");
    const api = await fetchOpenAiUsage({ date: "2026-10-24", startUtc: b.startUtc, endUtc: b.endUtc, env: {}, fetch: fake, timeoutMs: 1000 }, "admin", "proj_radar");
    expect(urls).toHaveLength(3);
    const q = new URL(urls[0]).searchParams;
    expect(q.get("bucket_width")).toBe("1h");
    expect(q.get("start_time")).toBe(String(b.startUtc.getTime() / 1000));
    expect(q.get("end_time")).toBe(String(b.endUtc.getTime() / 1000));
    expect(q.get("project_ids")).toBe("proj_radar");
    expect(api.get("gpt-4o-mini-2024-07-18")).toEqual({ requests: 4, inputTokens: 1000, outputTokens: 100 });
    const text = openAiReconciliation(api, [
      { provider: "openai", model: "gpt-4o-mini", requests: 5, errors: 1, inputTokens: 1000, outputTokens: 100, estimatedUsd: 0, reportedUsd: null },
    ], "proyecto Radar");
    expect(text).toContain("Usage API OpenAI (proyecto Radar, día MX exacto): 5 sol");
    expect(text).toContain("registro Radar: 4 sol");
    expect(text).toContain("diferencia +1 sol · +100/+10 tok");
  });

  it("Supabase: cómputo del proyecto atribuible; compartidos de la organización no", () => {
    expect(supabaseLine().estimatedUsd).toBeNull();
    expect(supabaseLine().missing[0]).toContain("SUPABASE_COMPUTE_SIZE");
    const micro = supabaseLine("Micro");
    expect(micro.estimatedUsd).toBeCloseTo(24 * 0.01344, 10);
    expect(micro.reportedUsd).toBeNull();
    expect(micro.missing.join(" ")).toContain("no se atribuyen");
    expect(supabaseLine("gigante").estimatedUsd).toBeNull();
  });

  it("los huecos se guardan por día MX", () => {
    expect(gapKey("2026-10-23")).toBe("cost_coverage:gaps:2026-10-23");
  });
});
