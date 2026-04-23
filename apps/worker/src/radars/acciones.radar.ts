import type { RadarConfig } from "../types/procurement";
import axios from "axios";
import { getSupabaseClient } from "../storage/client";

export interface AccionOpportunity {
  ticker: string;
  nombre: string;
  sector: string;
  mercado: string;
  precioActual: number;
  cambioDiaPct: number;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdCruce: boolean;
  volumenAnomalo: boolean;
  volumenActual: number | null;
  volumenPromedio: number | null;
  soporte: number | null;
  resistencia: number | null;
  momentum30dPct: number | null;
  targetPrice: number | null;
  upsidePct: number | null;
  horizonte: "corto" | "mediano" | "largo";
  razon: string;
  riesgo: "Alto" | "Medio" | "Bajo";
  riesgoRazon: string;
  accionSugerida: string;
  noticias: string[];
  score: number;
  scoreDesglose: { tecnico: number; tendencia: number; fundamental: number; riesgo: number };
  detectadoAt: string;
  alertaEnviada: boolean;
}

const YAHOO_QUOTES_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search";
const TICKERS = [
  "AAPL", "MSFT", "NVDA", "AMD", "GOOGL", "META", "TSLA", "AMZN",
  "XOM", "CVX", "OXY", "SLB", "JNJ", "UNH", "PFE", "SPY", "QQQ", "IWM", "GLD", "TLT",
  "AMXL.MX", "FEMSAUBD.MX", "WALMEX.MX", "CEMEXCPO.MX", "GFNORTEO.MX",
];

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? prev;
    prev = i === 0 ? value : value * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function calculateRsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calculateMacd(closes: number[]): { macd: number | null; signal: number | null; cruce: boolean } {
  if (closes.length < 35) return { macd: null, signal: null, cruce: false };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = closes.map((_, idx) => (ema12[idx] ?? 0) - (ema26[idx] ?? 0));
  const signalLine = ema(macdLine, 9);
  const lastMacd = macdLine[macdLine.length - 1] ?? null;
  const prevMacd = macdLine[macdLine.length - 2] ?? null;
  const lastSignal = signalLine[signalLine.length - 1] ?? null;
  const prevSignal = signalLine[signalLine.length - 2] ?? null;
  const cruce =
    lastMacd !== null && prevMacd !== null && lastSignal !== null && prevSignal !== null &&
    ((prevMacd <= prevSignal && lastMacd > lastSignal) || (prevMacd >= prevSignal && lastMacd < lastSignal));
  return { macd: lastMacd, signal: lastSignal, cruce };
}

function classifyHorizon(rsi: number | null, macdCruce: boolean, momentum30dPct: number | null, upsidePct: number | null): "corto" | "mediano" | "largo" {
  if (rsi !== null && (rsi < 35 || rsi > 65) && macdCruce) return "corto";
  if ((momentum30dPct ?? 0) > 4 || (upsidePct ?? 0) > 10) return "mediano";
  return "largo";
}

function scoreItem(rsi: number | null, macdCruce: boolean, volumenAnomalo: boolean, momentum30dPct: number | null, upsidePct: number | null, riesgo: "Alto" | "Medio" | "Bajo") {
  const tecnico = (rsi !== null && (rsi < 35 || rsi > 65) ? 20 : 8) + (macdCruce ? 15 : 5) + (volumenAnomalo ? 10 : 4);
  const tendencia = Math.max(5, Math.min(30, Math.round((momentum30dPct ?? 0) * 1.5 + 12)));
  const fundamental = Math.max(5, Math.min(30, Math.round((upsidePct ?? 0) + 10)));
  const riesgoScore = riesgo === "Bajo" ? 20 : riesgo === "Medio" ? 14 : 8;
  return { tecnico, tendencia, fundamental, riesgo: riesgoScore, score: Math.min(100, tecnico + tendencia + fundamental + riesgoScore) };
}

function inferRisk(rsi: number | null, cambioDiaPct: number, volumenAnomalo: boolean): { riesgo: "Alto" | "Medio" | "Bajo"; razon: string } {
  if (Math.abs(cambioDiaPct) > 4 || (rsi !== null && (rsi > 78 || rsi < 22))) {
    return { riesgo: "Alto", razon: "Volatilidad extrema de corto plazo" };
  }
  if (volumenAnomalo || Math.abs(cambioDiaPct) > 2) {
    return { riesgo: "Medio", razon: "Movimiento fuerte con presión de flujo" };
  }
  return { riesgo: "Bajo", razon: "Comportamiento técnico estable" };
}

async function fetchNews(ticker: string): Promise<string[]> {
  try {
    const res = await axios.get<{ news?: Array<{ title?: string }> }>(YAHOO_SEARCH_URL, {
      params: { q: ticker, newsCount: 3 },
      timeout: 15_000,
    });
    return (res.data.news ?? []).map((n) => String(n.title ?? "").trim()).filter((n) => n.length > 0).slice(0, 2);
  } catch {
    return [];
  }
}

export async function runAccionesRadar(): Promise<AccionOpportunity[]> {
  const detectadoAt = new Date().toISOString();
  const quoteResponse = await axios.get<{ quoteResponse?: { result?: Array<Record<string, unknown>> } }>(
    YAHOO_QUOTES_URL,
    { params: { symbols: TICKERS.join(",") }, timeout: 20_000 },
  );

  const quotes = quoteResponse.data.quoteResponse?.result ?? [];

  const opportunities = await Promise.all(
    quotes.map(async (quote) => {
      const ticker = String(quote.symbol ?? "");
      const precioActual = Number(quote.regularMarketPrice ?? 0);
      const cambioDiaPct = Number(quote.regularMarketChangePercent ?? 0);
      const volumenActual = Number(quote.regularMarketVolume ?? 0);
      const nombre = String(quote.longName ?? quote.shortName ?? ticker);
      const sector = String(quote.sector ?? quote.quoteType ?? "Sin sector");
      const mercado = ticker.endsWith(".MX") ? "BMV" : "NASDAQ/NYSE";

      let closes: number[] = [];
      let volumes: number[] = [];

      try {
        const chart = await axios.get<{
          chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }> } }> };
        }>(`${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}`, {
          params: { range: "6mo", interval: "1d" },
          timeout: 20_000,
        });
        const quoteSeries = chart.data.chart?.result?.[0]?.indicators?.quote?.[0];
        closes = (quoteSeries?.close ?? []).filter((v): v is number => typeof v === "number");
        volumes = (quoteSeries?.volume ?? []).filter((v): v is number => typeof v === "number");
      } catch {
        closes = [];
        volumes = [];
      }

      const rsi = calculateRsi(closes);
      const macdData = calculateMacd(closes);
      const volumenPromedio = volumes.length > 0 ? volumes.slice(-30).reduce((a, v) => a + v, 0) / Math.min(30, volumes.length) : null;
      const volumenAnomalo = volumenPromedio !== null && volumenActual > 0 ? volumenActual >= volumenPromedio * 1.8 : false;
      const soporte = closes.length > 30 ? Math.min(...closes.slice(-30)) : null;
      const resistencia = closes.length > 30 ? Math.max(...closes.slice(-30)) : null;
      const first30 = closes.length > 30 ? closes[closes.length - 30] : null;
      const momentum30dPct = first30 && first30 > 0 ? ((precioActual - first30) / first30) * 100 : null;

      const targetMean = Number(quote.targetMeanPrice ?? NaN);
      const targetPrice = Number.isFinite(targetMean) && targetMean > 0 ? targetMean : resistencia ? resistencia * 1.06 : null;
      const upsidePct = targetPrice && precioActual > 0 ? ((targetPrice - precioActual) / precioActual) * 100 : null;

      const riskData = inferRisk(rsi, cambioDiaPct, volumenAnomalo);
      const horizon = classifyHorizon(rsi, macdData.cruce, momentum30dPct, upsidePct);
      const scoreData = scoreItem(rsi, macdData.cruce, volumenAnomalo, momentum30dPct, upsidePct, riskData.riesgo);

      const reason =
        horizon === "corto"
          ? `RSI ${rsi === null ? "N/D" : rsi.toFixed(1)}, MACD ${macdData.cruce ? "con cruce" : "sin cruce"}, volumen ${volumenAnomalo ? "anómalo" : "normal"}`
          : horizon === "mediano"
            ? `Tendencia 30d ${momentum30dPct === null ? "N/D" : `${momentum30dPct.toFixed(1)}%`} con soporte ${soporte === null ? "N/D" : soporte.toFixed(2)}`
            : `Upside estimado ${upsidePct === null ? "N/D" : `${upsidePct.toFixed(1)}%`} y fortaleza relativa sectorial`;

      const action = `Comprar en $${precioActual.toFixed(2)}, stop-loss en $${(precioActual * 0.93).toFixed(2)}, objetivo ${targetPrice === null ? "N/D" : `$${targetPrice.toFixed(2)}`}`;
      const noticias = await fetchNews(ticker);

      const item: AccionOpportunity = {
        ticker,
        nombre,
        sector,
        mercado,
        precioActual,
        cambioDiaPct,
        rsi,
        macd: macdData.macd,
        macdSignal: macdData.signal,
        macdCruce: macdData.cruce,
        volumenAnomalo,
        volumenActual: volumenActual > 0 ? volumenActual : null,
        volumenPromedio,
        soporte,
        resistencia,
        momentum30dPct,
        targetPrice,
        upsidePct,
        horizonte: horizon,
        razon: reason,
        riesgo: riskData.riesgo,
        riesgoRazon: riskData.razon,
        accionSugerida: action,
        noticias,
        score: scoreData.score,
        scoreDesglose: {
          tecnico: scoreData.tecnico,
          tendencia: scoreData.tendencia,
          fundamental: scoreData.fundamental,
          riesgo: scoreData.riesgo,
        },
        detectadoAt,
        alertaEnviada: false,
      };

      return item;
    }),
  );

  const filtered = opportunities
    .filter((item) => item.ticker.length > 0 && item.precioActual > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  const db = getSupabaseClient();
  if (filtered.length > 0) {
    await db.from("inv_acciones").insert(
      filtered.map((item) => ({
        ticker: item.ticker,
        nombre: item.nombre,
        "señal": item.horizonte,
        precio_actual: item.precioActual,
        precio_objetivo: item.targetPrice,
        rsi: item.rsi,
        macd: item.macd,
        volumen_anomalo: item.volumenAnomalo,
        sector: item.sector,
        mercado: item.mercado,
        score: item.score,
        detectado_at: item.detectadoAt,
        alerta_enviada: item.alertaEnviada,
      })),
    );
  }

  return filtered;
}

export const accionesRadar: RadarConfig = {
  key: "inv_acciones",
  name: "Radar Acciones por Horizonte",
  description: "Monitorea señales técnicas, momentum y upside con segmentación corto/mediano/largo plazo.",
  isActive: true,
  priority: 5,
  scheduleMinutes: 1440,
  minScore: 0,
  includeTerms: ["acciones", "rsi", "macd", "volumen", "upside", "horizonte"],
  excludeTerms: [],
  geoTerms: [],
  entityTerms: ["AAPL", "MSFT", "NVDA", "AMZN", "QQQ", "SPY", "AMXL"],
  rules: [
    {
      ruleType: "keyword",
      fieldName: "canonical_text",
      operator: "any_of",
      value: ["acciones", "rsi", "macd", "momentum"],
      weight: 1,
      isRequired: false,
    },
  ],
};
