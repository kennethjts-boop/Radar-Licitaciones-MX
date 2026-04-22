import type { RadarConfig } from "../types/procurement";
import axios from "axios";
import { getSupabaseClient } from "../storage/client";

export interface PetroleoOpportunity {
  tipo: "WTI" | "BRENT";
  precio: number;
  cambioDiarioPct: number;
  cambioSemanalPct: number;
  cambioMensualPct: number;
  precioSoporte: number;
  precioResistencia: number;
  tendencia: "alcista" | "bajista" | "lateral";
  senal: "compra" | "venta" | "espera";
  justificacionSenal: string;
  inventariosCambioPct: number | null;
  inventariosEsperadoPct: number | null;
  contextoGeopolitico: string;
  objetivo30dMin: number;
  objetivo30dMax: number;
  riesgos: string[];
  proximosEventos: Array<{ nombre: string; fecha: string }>;
  score: number;
  detectadoAt: string;
  alertaEnviada: boolean;
}

const ALPHA_URL = "https://www.alphavantage.co/query";
const EIA_URL = "https://api.eia.gov/v2/petroleum/stoc/wstk/data";

async function fetchCommoditySeries(functionName: "WTI" | "BRENT", apiKey: string): Promise<number[] | null> {
  const response = await axios.get<{ data?: Array<{ value?: string }> }>(ALPHA_URL, {
    params: { function: functionName, interval: "daily", apikey: apiKey },
    timeout: 20_000,
  });

  const values = (response.data.data ?? [])
    .map((row) => Number(row.value ?? NaN))
    .filter((v) => Number.isFinite(v));

  return values.length >= 22 ? values : null;
}

async function fetchInventoriesChangePct(apiKey: string): Promise<{ actualPct: number | null; expectedPct: number | null }> {
  const response = await axios.get<{ response?: { data?: Array<{ value?: string }> } }>(EIA_URL, {
    params: {
      api_key: apiKey,
      frequency: "weekly",
      data: ["value"],
      sort: "[{'column':'period','direction':'desc'}]",
      length: 3,
    },
    timeout: 20_000,
  });

  const rows = response.data.response?.data ?? [];
  const latest = Number(rows[0]?.value ?? NaN);
  const prev = Number(rows[1]?.value ?? NaN);
  const prev2 = Number(rows[2]?.value ?? NaN);

  if (!Number.isFinite(latest) || !Number.isFinite(prev) || prev === 0) {
    return { actualPct: null, expectedPct: null };
  }

  const actualPct = ((latest - prev) / prev) * 100;
  const expectedPct = Number.isFinite(prev2) && prev2 > 0 ? ((prev - prev2) / prev2) * 100 : null;
  return { actualPct, expectedPct };
}

function detectTrend(weeklyPct: number, monthlyPct: number): "alcista" | "bajista" | "lateral" {
  if (weeklyPct > 1.5 && monthlyPct > 2.5) return "alcista";
  if (weeklyPct < -1.5 && monthlyPct < -2.5) return "bajista";
  return "lateral";
}

function buildSignal(cambioSemanalPct: number, inventariosCambioPct: number | null, tendencia: "alcista" | "bajista" | "lateral") {
  if (tendencia === "alcista" && (inventariosCambioPct ?? 0) < 0) {
    return { senal: "compra" as const, justificacion: "Tendencia alcista con caída de inventarios" };
  }
  if (tendencia === "bajista" && (inventariosCambioPct ?? 0) > 0) {
    return { senal: "venta" as const, justificacion: "Debilidad de precio y acumulación de inventarios" };
  }
  if (Math.abs(cambioSemanalPct) < 1) {
    return { senal: "espera" as const, justificacion: "Mercado lateral sin confirmación direccional" };
  }
  return { senal: "espera" as const, justificacion: "Señales mixtas; esperar confirmación" };
}

function scorePetroleo(tendencia: "alcista" | "bajista" | "lateral", inventariosCambioPct: number | null, signal: "compra" | "venta" | "espera"): number {
  const trendScore = tendencia === "lateral" ? 20 : 35;
  const invScore = inventariosCambioPct === null ? 10 : Math.abs(inventariosCambioPct) > 2 ? 30 : 18;
  const signalScore = signal === "espera" ? 20 : 30;
  return Math.min(100, trendScore + invScore + signalScore);
}

export async function runPetroleoRadar(): Promise<PetroleoOpportunity[]> {
  const alphaKey = process.env.ALPHA_VANTAGE_API_KEY ?? "";
  const eiaKey = process.env.EIA_API_KEY ?? "";
  const detectadoAt = new Date().toISOString();

  const [wtiSeries, brentSeries, inventories] = await Promise.all([
    alphaKey ? fetchCommoditySeries("WTI", alphaKey).catch(() => null) : Promise.resolve(null),
    alphaKey ? fetchCommoditySeries("BRENT", alphaKey).catch(() => null) : Promise.resolve(null),
    eiaKey ? fetchInventoriesChangePct(eiaKey).catch(() => ({ actualPct: null, expectedPct: null })) : Promise.resolve({ actualPct: null, expectedPct: null }),
  ]);

  const geopolitical = "Monitorear tensiones en Medio Oriente y cumplimiento de recortes OPEP+";
  const upcoming = [
    { nombre: "Reporte EIA inventarios", fecha: "Próximo miércoles 10:30 ET" },
    { nombre: "Reunión OPEP+", fecha: "Siguiente reunión oficial programada" },
    { nombre: "Datos macro USA (inflación/empleo)", fecha: "Esta y próxima semana" },
  ];

  const raw: Array<{ tipo: "WTI" | "BRENT"; series: number[] | null }> = [
    { tipo: "WTI", series: wtiSeries },
    { tipo: "BRENT", series: brentSeries },
  ];

  const opportunities: PetroleoOpportunity[] = raw
    .filter((r): r is { tipo: "WTI" | "BRENT"; series: number[] } => Array.isArray(r.series) && r.series.length >= 22)
    .map((entry) => {
      const current = entry.series[0];
      const prevDay = entry.series[1];
      const prevWeek = entry.series[5];
      const prevMonth = entry.series[21];

      const cambioDiarioPct = prevDay > 0 ? ((current - prevDay) / prevDay) * 100 : 0;
      const cambioSemanalPct = prevWeek > 0 ? ((current - prevWeek) / prevWeek) * 100 : 0;
      const cambioMensualPct = prevMonth > 0 ? ((current - prevMonth) / prevMonth) * 100 : 0;
      const soporte = Math.min(...entry.series.slice(0, 20));
      const resistencia = Math.max(...entry.series.slice(0, 20));
      const tendencia = detectTrend(cambioSemanalPct, cambioMensualPct);
      const signal = buildSignal(cambioSemanalPct, inventories.actualPct, tendencia);
      const score = scorePetroleo(tendencia, inventories.actualPct, signal.senal);

      return {
        tipo: entry.tipo,
        precio: current,
        cambioDiarioPct,
        cambioSemanalPct,
        cambioMensualPct,
        precioSoporte: soporte,
        precioResistencia: resistencia,
        tendencia,
        senal: signal.senal,
        justificacionSenal: signal.justificacion,
        inventariosCambioPct: inventories.actualPct,
        inventariosEsperadoPct: inventories.expectedPct,
        contextoGeopolitico: geopolitical,
        objetivo30dMin: current * 0.96,
        objetivo30dMax: current * 1.06,
        riesgos: [
          "Sorpresa en inventarios EIA",
          "Cambio abrupto en política OPEP+",
          "Desaceleración macro global y caída de demanda",
        ],
        proximosEventos: upcoming,
        score,
        detectadoAt,
        alertaEnviada: false,
      };
    });

  const db = getSupabaseClient();
  if (opportunities.length > 0) {
    await db.from("inv_petroleo").insert(
      opportunities.map((item) => ({
        tipo: item.tipo,
        precio: item.precio,
        cambio_pct: item.cambioSemanalPct,
        precio_soporte: item.precioSoporte,
        precio_resistencia: item.precioResistencia,
        "señal": item.senal,
        evento: item.contextoGeopolitico,
        inventarios_cambio_pct: item.inventariosCambioPct,
        score: item.score,
        detectado_at: item.detectadoAt,
        alerta_enviada: item.alertaEnviada,
      })),
    );
  }

  return opportunities.sort((a, b) => b.score - a.score);
}

export const petroleoRadar: RadarConfig = {
  key: "inv_petroleo",
  name: "Radar Petróleo Ejecutivo",
  description: "Briefing de inversión en energía con WTI/Brent, inventarios EIA y señal táctica.",
  isActive: false,
  priority: 5,
  scheduleMinutes: 2880,
  minScore: 0,
  includeTerms: ["petroleo", "wti", "brent", "eia", "opep", "energia"],
  excludeTerms: [],
  geoTerms: [],
  entityTerms: ["WTI", "BRENT", "EIA", "OPEP+"],
  rules: [
    {
      ruleType: "keyword",
      fieldName: "canonical_text",
      operator: "any_of",
      value: ["petroleo", "wti", "brent", "inventarios"],
      weight: 1,
      isRequired: false,
    },
  ],
};
