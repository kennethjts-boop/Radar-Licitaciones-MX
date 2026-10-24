import { aggregateAiUsage, buildUsageRow, type AiUsageRow } from "../ai-usage";
import { compareMetrics, computeTotals, DEFAULT_THRESHOLDS } from "../analysis";
import { formatCostReport } from "../format";
import { mexicoClock, mexicoDayBounds, previousDates, reportDateFor } from "../period";
import { estimateTokenCost } from "../pricing";
import { buildOpenRouterLine, openRouterDayDelta } from "../providers/openrouter";
import { estimateRailwayCost } from "../providers/railway";
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
      "attempt", "cost_estimated_usd", "cost_reported_usd", "error_kind", "input_tokens",
      "model", "occurred_at", "operation", "output_tokens", "provider", "status",
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

  it("OpenRouter: diferencia entre cortes de medianoche y atribución", () => {
    const s = (usageUsd: number, delayMinutes = 0) => ({ usageUsd, capturedAt: "", delayMinutes });
    expect(openRouterDayDelta(s(10), s(10.5)).usd).toBeCloseTo(0.5);
    expect(openRouterDayDelta(null, s(1)).usd).toBeNull();
    expect(openRouterDayDelta(s(1, 45), s(2)).usd).toBeNull();
    expect(openRouterDayDelta(s(5), s(4)).usd).toBeNull();
    const shared = buildOpenRouterLine({ env: { OPENROUTER_API_KEY: "k" } }, { usd: 0.5 }, 0.4);
    expect(shared.reportedUsd).toBeNull();
    expect(shared.reference?.usd).toBe(0.5);
    const dedicated = buildOpenRouterLine({ env: { OPENROUTER_API_KEY: "k", OPENROUTER_KEY_DEDICATED: true } }, { usd: 0.5 }, 0.4);
    expect(dedicated.reportedUsd).toBe(0.5);
  });

  it("Railway: filtra por servicio y aplica tarifa por minuto", () => {
    const est = estimateRailwayCost(
      [
        { measurement: "CPU_USAGE", value: 100, tags: { serviceId: "svc" } },
        { measurement: "MEMORY_USAGE_GB", value: 1000, tags: { serviceId: "svc" } },
        { measurement: "NETWORK_TX_GB", value: 2, tags: { serviceId: "svc" } },
        { measurement: "CPU_USAGE", value: 9999, tags: { serviceId: "otro" } },
      ],
      "svc",
    );
    expect(est.usd).toBeCloseTo(100 * 0.000463 + 1000 * 0.000231 + 2 * 0.05);
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
    ai: { requests, errors: 0, retries: 0, inputTokens: 0, outputTokens: 0, unpricedRequests: 0, unverifiedPricingModels: [], errorKinds: {}, byModel: [] },
    totals: computeTotals(providers),
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
