import { aggregateAiUsage, buildUsageRow, usageFromResponse, type AiUsageRow } from "../ai-usage";
import { compareMetrics, computeTotals, DEFAULT_THRESHOLDS } from "../analysis";
import { formatCostReport } from "../format";
import { mexicoClock, mexicoDayBounds, previousDates, reportDateFor } from "../period";
import { estimateTokenCost } from "../pricing";
import { buildOpenRouterLine, openRouterDayDelta, openRouterKeyId } from "../providers/openrouter";
import { collectRailway, RAILWAY_COST_UNAVAILABLE, railwayServiceMetrics } from "../providers/railway";
import { supabaseLine } from "../providers/supabase";
import { claimReport, reportKey, type StateStore } from "../report-state";
import type { DayCostMetrics, ProviderLine } from "../types";

function memoryStore(): StateStore & { data: Map<string, any> } {
  const data = new Map<string, any>();
  return {
    data,
    async insertIfAbsent(key, value) {
      if (data.has(key)) return false;
      data.set(key, structuredClone(value));
      return true;
    },
    async read(key) {
      return data.has(key) ? structuredClone(data.get(key)) : null;
    },
    async readMany(keys) {
      const out = new Map();
      for (const k of keys) if (data.has(k)) out.set(k, structuredClone(data.get(k)));
      return out;
    },
    async compareAndSet(key, expected, value) {
      const cur = data.get(key);
      if (!cur || cur.status !== expected.status || cur.attempts !== expected.attempts) return false;
      data.set(key, structuredClone(value));
      return true;
    },
    async write(key, value) {
      data.set(key, structuredClone(value));
    },
  };
}

describe("periodos America/Mexico_City", () => {
  it("el día MX es [06:00Z, 06:00Z del día siguiente)", () => {
    const b = mexicoDayBounds("2026-10-23");
    expect(b.startUtc.toISOString()).toBe("2026-10-23T06:00:00.000Z");
    expect(b.endUtc.toISOString()).toBe("2026-10-24T06:00:00.000Z");
  });

  it("a las 08:00 MX se reporta el día anterior; 23:59 MX sigue siendo el mismo día", () => {
    expect(reportDateFor(new Date("2026-10-24T14:00:00Z"))).toBe("2026-10-23"); // 08:00 MX
    expect(reportDateFor(new Date("2026-10-25T05:59:00Z"))).toBe("2026-10-23"); // 23:59 MX del 24
    expect(mexicoClock(new Date("2026-10-24T14:00:00Z"))).toEqual({ hour: 8, minute: 0 });
  });

  it("cruza fin de mes y año", () => {
    expect(reportDateFor(new Date("2027-01-01T14:00:00Z"))).toBe("2026-12-31");
    expect(previousDates("2026-03-01", 2)).toEqual(["2026-02-28", "2026-02-27"]);
  });
});

describe("cálculo", () => {
  it("estima tokens con tarifa y no estima modelos desconocidos", () => {
    expect(estimateTokenCost("gpt-4o-mini", 1_000_000, 1_000_000).usd).toBeCloseTo(0.75);
    expect(estimateTokenCost("openai/gpt-4o-mini", 1_000_000, 0).usd).toBeCloseTo(0.15);
    expect(estimateTokenCost("google/gemma-2-9b-it:free", 5000, 5000).usd).toBe(0);
    expect(estimateTokenCost("modelo-x", 1000, 1000).usd).toBeNull();
  });

  it("buildUsageRow sólo guarda metadatos mínimos", () => {
    const row = buildUsageRow({ provider: "openai", model: "gpt-4o-mini", operation: "x", status: "ok", inputTokens: 10, outputTokens: 5 });
    expect(Object.keys(row).sort()).toEqual([
      "attempt", "cost_estimated_usd", "cost_reported_usd", "error_kind", "http_attempts", "input_tokens",
      "key_id", "model", "occurred_at", "operation", "output_tokens", "provider", "status",
    ]);
  });

  it("agrega solicitudes, errores, reintentos y prefiere el costo informado", () => {
    const rows: AiUsageRow[] = [
      { provider: "openrouter", model: "openai/gpt-4o-mini", status: "error", attempt: 1, input_tokens: null, output_tokens: null, cost_reported_usd: null, cost_estimated_usd: null, error_kind: "http_429" },
      { provider: "openrouter", model: "openai/gpt-4o-mini", status: "ok", attempt: 2, input_tokens: 1000, output_tokens: 100, cost_reported_usd: "0.0005", cost_estimated_usd: "0.0002" },
      { provider: "openai", model: "modelo-x", status: "ok", attempt: 1, input_tokens: 50, output_tokens: 50, cost_reported_usd: null, cost_estimated_usd: null, error_kind: null },
    ] as AiUsageRow[];
    const s = aggregateAiUsage(rows);
    expect(s).toMatchObject({ requests: 3, errors: 1, retries: 1, inputTokens: 1050, outputTokens: 150, unpricedRequests: 1 });
    expect(s.errorKinds).toEqual({ http_429: 1 });
    const or = s.byModel.find((m) => m.provider === "openrouter")!;
    expect(or.estimatedUsd).toBeCloseTo(0.0005);
    expect(s.byModel.find((m) => m.model === "modelo-x")!.estimatedUsd).toBeNull();
  });

  it("confirmado y estimado no se mezclan; sin cifra no es $0", () => {
    const lines: ProviderLine[] = [
      { provider: "openai", reportedUsd: null, estimatedUsd: 0.3, missing: [] },
      { provider: "openrouter", reportedUsd: 0.12, estimatedUsd: 0.11, missing: [] },
      { provider: "railway", reportedUsd: null, estimatedUsd: 0.41, missing: [] },
      supabaseLine(),
    ];
    const t = computeTotals(lines);
    expect(t.confirmedUsd).toBeCloseTo(0.12);
    expect(t.confirmedProviders).toEqual(["openrouter"]);
    expect(t.estimatedUsd).toBeCloseTo(0.82);
    expect(t.estimateExcludes).toEqual(["supabase"]);
    expect(computeTotals([supabaseLine()]).confirmedUsd).toBeNull();
  });

  it("embeddings: usa prompt_tokens/total_tokens sin completion_tokens y estima costo", () => {
    // Forma real de POST /v1/embeddings (text-embedding-3-small).
    const response = {
      object: "list",
      data: [{ object: "embedding", index: 0, embedding: [0.0023, -0.0093, 0.0157] }],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 1200, total_tokens: 1200 },
    };
    const usage = usageFromResponse(response, "embedding");
    expect(usage).toEqual({ inputTokens: 1200, outputTokens: 0, reportedCostUsd: null });
    const row = buildUsageRow({ provider: "openai", model: "text-embedding-3-small", operation: "embedding", status: "ok", ...usage });
    expect(row.input_tokens).toBe(1200);
    expect(row.output_tokens).toBe(0);
    expect(row.cost_estimated_usd).toBeCloseTo((1200 * 0.02) / 1_000_000, 12);
    // Sólo total_tokens: se toma como entrada.
    expect(usageFromResponse({ usage: { total_tokens: 40 } }, "embedding").inputTokens).toBe(40);
    // En chat, faltar completion_tokens no se convierte en 0.
    expect(usageFromResponse({ usage: { prompt_tokens: 10 } }).outputTokens).toBeNull();
  });

  describe("OpenRouter", () => {
    const keyA = openRouterKeyId("clave-ficticia-A");
    const keyB = openRouterKeyId("clave-ficticia-B");
    const snap = (usageUsd: number, capturedAt: string, keyId = keyA) => ({ usageUsd, capturedAt, keyId });
    // Día MX 2026-10-23 = [2026-10-23T06:00Z, 2026-10-24T06:00Z)
    const start = "2026-10-23T06:00:04.000Z";
    const end = "2026-10-24T06:00:03.000Z";

    it("la huella de la clave no expone la clave", () => {
      expect(keyA).toMatch(/^sha256:[0-9a-f]{16}$/);
      expect(keyA).not.toContain("clave");
      expect(keyA).not.toBe(keyB);
    });

    it("cortes a las 00:00 MX de la misma clave: diferencia alineada", () => {
      const d = openRouterDayDelta("2026-10-23", snap(10, start), snap(10.5, end));
      expect(d).toMatchObject({ aligned: true, periodStart: start, periodEnd: end });
      expect(d.usd).toBeCloseTo(0.5);
      const line = buildOpenRouterLine({ env: { OPENROUTER_API_KEY: "k", OPENROUTER_KEY_DEDICATED: true } }, d, 0.4);
      expect(line.reportedUsd).toBeCloseTo(0.5);
    });

    it("corte retrasado: referencia con fechas reales, nunca confirmado", () => {
      const late = "2026-10-23T09:12:00.000Z"; // 03:12 MX tras un reinicio
      const d = openRouterDayDelta("2026-10-23", snap(10, late), snap(10.5, end));
      expect(d.aligned).toBe(false);
      expect(d.periodStart).toBe(late);
      const line = buildOpenRouterLine({ env: { OPENROUTER_API_KEY: "k", OPENROUTER_KEY_DEDICATED: true } }, d, 0.4);
      expect(line.reportedUsd).toBeNull();
      expect(line.reference?.period).toBe("23/10 03:12:00 → 24/10 00:00:03 CDMX (contador de la clave)");
      expect(line.reference?.reason).toContain("no cubre exactamente el día MX");
    });

    it("claves distintas no se comparan aunque el contador suba", () => {
      const d = openRouterDayDelta("2026-10-23", snap(10, start, keyA), snap(25, end, keyB));
      expect(d.usd).toBeNull();
      expect(d.problem).toContain("claves distintas");
      expect(openRouterDayDelta("2026-10-23", snap(10, start, ""), snap(11, end, "")).usd).toBeNull();
    });

    it("faltante o contador que baja: sin cifra", () => {
      expect(openRouterDayDelta("2026-10-23", null, snap(1, end)).usd).toBeNull();
      expect(openRouterDayDelta("2026-10-23", snap(5, start), snap(4, end)).usd).toBeNull();
    });

    it("clave no exclusiva: referencia aunque esté alineado", () => {
      const d = openRouterDayDelta("2026-10-23", snap(10, start), snap(10.5, end));
      const line = buildOpenRouterLine({ env: { OPENROUTER_API_KEY: "k" } }, d, 0.4);
      expect(line.reportedUsd).toBeNull();
      expect(line.reference?.usd).toBeCloseTo(0.5);
    });
  });

  it("Railway: muestra métricas crudas del servicio y nunca costo", async () => {
    const usage = [
      { measurement: "CPU_USAGE", value: 100, tags: { serviceId: "svc" } },
      { measurement: "MEMORY_USAGE_GB", value: 1000, tags: { serviceId: "svc" } },
      { measurement: "CPU_USAGE", value: 9999, tags: { serviceId: "otro" } },
    ];
    expect(railwayServiceMetrics(usage, "svc")).toEqual({ CPU_USAGE: 100, MEMORY_USAGE_GB: 1000 });
    const fakeFetch = (async () => ({ ok: true, json: async () => ({ data: { usage } }) })) as unknown as typeof fetch;
    const b = mexicoDayBounds("2026-10-23");
    const line = await collectRailway({
      date: "2026-10-23", startUtc: b.startUtc, endUtc: b.endUtc, fetch: fakeFetch, timeoutMs: 1000,
      env: { RAILWAY_API_TOKEN: "t", RAILWAY_PROJECT_ID: "p", RAILWAY_SERVICE_ID: "svc" },
    });
    expect(line.estimatedUsd).toBeNull();
    expect(line.reportedUsd).toBeNull();
    expect(line.metricsDetail).toContain("CPU_USAGE=100");
    expect(line.missing).toContain(RAILWAY_COST_UNAVAILABLE);
    const totals = computeTotals([{ provider: "openai", reportedUsd: null, estimatedUsd: 1, missing: [] }, line]);
    expect(totals.estimatedUsd).toBe(1);
    expect(totals.estimateExcludes).toEqual(["railway"]);
  });
});

function day(date: string, estimated: number, requests = 100): DayCostMetrics {
  const providers: ProviderLine[] = [
    { provider: "openai", reportedUsd: null, estimatedUsd: estimated, missing: [] },
    supabaseLine(),
  ];
  return {
    date,
    periodStartUtc: mexicoDayBounds(date).startUtc.toISOString(),
    periodEndUtc: mexicoDayBounds(date).endUtc.toISOString(),
    providers,
    ai: { requests, errors: 0, retries: 0, httpRetries: 0, retriesUnobserved: 0, inputTokens: 0, outputTokens: 0, unpricedRequests: 0, unverifiedPricingModels: [], errorKinds: {}, byModel: [] },
    totals: computeTotals(providers),
    coverage: { status: "complete", since: "2026-10-01T00:00:00.000Z", droppedEvents: 0 },
  };
}

describe("anomalías", () => {
  it("sin 3 días comparables: formando línea base", () => {
    const c = compareMetrics(day("2026-10-23", 10), [day("2026-10-22", 1), day("2026-10-21", 1)]);
    expect(c.find((x) => x.key === "total.estimated")!.status).toBe("baseline");
  });

  it("exige >50% Y >US$1 sobre el promedio", () => {
    const hist = [day("2026-10-22", 1), day("2026-10-21", 1), day("2026-10-20", 1)];
    // +60% pero sólo +0.6 USD → no se marca
    expect(compareMetrics(day("2026-10-23", 1.6), hist).find((x) => x.key === "total.estimated")!.status).toBe("ok");
    // +150% y +1.5 USD → revisión
    const r = compareMetrics(day("2026-10-23", 2.5), hist).find((x) => x.key === "total.estimated")!;
    expect(r).toMatchObject({ status: "review", average: 1, previous: 1, sampleDays: 3 });
  });

  it("umbral configurable y pico de solicitudes", () => {
    const hist = [day("2026-10-22", 1, 100), day("2026-10-21", 1, 100), day("2026-10-20", 1, 100)];
    const c = compareMetrics(day("2026-10-23", 1, 400), hist, { ...DEFAULT_THRESHOLDS, pct: 100 });
    expect(c.find((x) => x.key === "ai.requests")!.status).toBe("review");
  });

  it("'ayer' es la fecha exacta anterior; si falta no se sustituye", () => {
    // Falta 2026-10-22: hay 21, 20 y 19 (y uno fuera de ventana, 2026-10-10).
    const hist = [day("2026-10-21", 1), day("2026-10-20", 1), day("2026-10-19", 1), day("2026-10-10", 50)];
    const c = compareMetrics(day("2026-10-23", 3), hist).find((x) => x.key === "total.estimated")!;
    expect(c.previous).toBeNull();
    expect(c).toMatchObject({ average: 1, sampleDays: 3, status: "review" });
    const text = formatCostReport(day("2026-10-23", 3), [c], { generatedAt: new Date("2026-10-24T14:00:00Z"), thresholds: DEFAULT_THRESHOLDS });
    expect(text).toContain("vs ayer sin datos");
    // Con el día exacto presente, sí se usa aunque el arreglo venga desordenado.
    const c2 = compareMetrics(day("2026-10-23", 3), [day("2026-10-21", 1), day("2026-10-22", 2)]).find((x) => x.key === "total.estimated")!;
    expect(c2.previous).toBe(2);
  });

  it("no compara totales con distinta composición de proveedores", () => {
    const hist = [1, 2, 3].map((i) => {
      const d = day(`2026-10-2${i}`, 1);
      d.providers.push({ provider: "railway", reportedUsd: null, estimatedUsd: 0.5, missing: [] });
      d.totals = computeTotals(d.providers);
      return d;
    });
    const c = compareMetrics(day("2026-10-23", 5), hist).find((x) => x.key === "total.estimated")!;
    expect(c.status).toBe("baseline");
  });
});

describe("un solo envío por día", () => {
  it("dos instancias solapadas: sólo una reclama", async () => {
    const store = memoryStore();
    const [a, b] = await Promise.all([
      claimReport(store, "2026-10-23", "A", 3),
      claimReport(store, "2026-10-23", "B", 3),
    ]);
    expect([a.claimed, b.claimed].filter(Boolean)).toHaveLength(1);
  });

  it("enviado o incierto nunca se reenvía; fallido reintenta hasta el máximo", async () => {
    const store = memoryStore();
    const key = reportKey("2026-10-23");
    await claimReport(store, "2026-10-23", "A", 3);
    store.data.set(key, { ...store.data.get(key), status: "sent" });
    expect(await claimReport(store, "2026-10-23", "B", 3)).toEqual({ claimed: false, reason: "already_sent" });

    store.data.set(key, { ...store.data.get(key), status: "uncertain" });
    expect((await claimReport(store, "2026-10-23", "B", 3)).claimed).toBe(false);

    store.data.set(key, { ...store.data.get(key), status: "failed", attempts: 1 });
    const retries = await Promise.all([claimReport(store, "2026-10-23", "B", 3), claimReport(store, "2026-10-23", "C", 3)]);
    expect(retries.filter((r) => r.claimed)).toEqual([{ claimed: true, attempt: 2 }]);

    store.data.set(key, { ...store.data.get(key), status: "failed", attempts: 3 });
    expect(await claimReport(store, "2026-10-23", "D", 3)).toEqual({ claimed: false, reason: "max_attempts" });
  });
});

describe("formato", () => {
  it("es determinista, separa confirmado/estimado y lista faltantes", () => {
    const d = day("2026-10-23", 0.31);
    const opts = { generatedAt: new Date("2026-10-24T14:00:05Z"), thresholds: DEFAULT_THRESHOLDS };
    const a = formatCostReport(d, compareMetrics(d, []), opts);
    expect(a).toBe(formatCostReport(d, compareMetrics(d, []), opts));
    expect(a).toContain("00:00–24:00 America/Mexico_City (23/10 06:00Z → 24/10 06:00Z)");
    expect(a).toContain("Confirmado: no disponible");
    expect(a).toContain("Estimado: US$0.31");
    expect(a).toContain("Supabase");
    expect(a).toContain("formando línea base");
    expect(a).not.toMatch(/Supabase<\/b> — US\$0/);
  });
});
