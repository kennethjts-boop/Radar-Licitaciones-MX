import type { RadarConfig } from "../types/procurement";
import axios from "axios";
import { getSupabaseClient } from "../storage/client";

export interface AccionOpportunity {
  ticker: string;
  nombre: string;
  senal: "compra" | "venta" | "neutral";
  precioActual: number;
  precioObjetivo: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdCruce: boolean;
  volumenAnomalo: boolean;
  volumenActual: number | null;
  volumenPromedio: number | null;
  sector: string;
  mercado: string;
  score: number;
  detectadoAt: string;
  alertaEnviada: boolean;
}

const YAHOO_QUOTES_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const BASE_TICKERS = ["AAPL", "MSFT", "NVDA", "AMZN", "PE&OLES.MX"];

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
  if (closes.length < 35) {
    return { macd: null, signal: null, cruce: false };
  }

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = closes.map((_, idx) => (ema12[idx] ?? 0) - (ema26[idx] ?? 0));
  const signalLine = ema(macdLine, 9);

  const lastMacd = macdLine[macdLine.length - 1] ?? null;
  const prevMacd = macdLine[macdLine.length - 2] ?? null;
  const lastSignal = signalLine[signalLine.length - 1] ?? null;
  const prevSignal = signalLine[signalLine.length - 2] ?? null;

  const cruce =
    lastMacd !== null &&
    prevMacd !== null &&
    lastSignal !== null &&
    prevSignal !== null &&
    ((prevMacd <= prevSignal && lastMacd > lastSignal) ||
      (prevMacd >= prevSignal && lastMacd < lastSignal));

  return { macd: lastMacd, signal: lastSignal, cruce };
}

function scoreAccion(
  rsi: number | null,
  volumenAnomalo: boolean,
  macdCruce: boolean,
): number {
  const rsiScore = rsi !== null && (rsi < 30 || rsi > 70) ? 40 : 0;
  const volumenScore = volumenAnomalo ? 30 : 0;
  const macdScore = macdCruce ? 30 : 0;
  return Math.min(100, rsiScore + volumenScore + macdScore);
}

function signalFromRsi(rsi: number | null): "compra" | "venta" | "neutral" {
  if (rsi === null) return "neutral";
  if (rsi < 30) return "compra";
  if (rsi > 70) return "venta";
  return "neutral";
}

export async function runAccionesRadar(): Promise<AccionOpportunity[]> {
  const detectadoAt = new Date().toISOString();

  const quoteResponse = await axios.get<{ quoteResponse?: { result?: Array<Record<string, unknown>> } }>(
    YAHOO_QUOTES_URL,
    {
      params: { symbols: BASE_TICKERS.join(",") },
      timeout: 20_000,
    },
  );

  const quotes = quoteResponse.data.quoteResponse?.result ?? [];

  const opportunities = await Promise.all(
    quotes.map(async (quote) => {
      const ticker = String(quote.symbol ?? "");
      const precioActual = Number(quote.regularMarketPrice ?? 0);
      const volumenActual = Number(quote.regularMarketVolume ?? 0);
      const nombre = String(quote.longName ?? quote.shortName ?? ticker);
      const sector = String(quote.sector ?? "Sin sector");
      const mercado = ticker.endsWith(".MX") ? "BMV" : "NASDAQ/NYSE";
      const precioObjetivoRaw = Number(quote.targetMeanPrice ?? NaN);
      const precioObjetivo = Number.isFinite(precioObjetivoRaw) ? precioObjetivoRaw : null;

      let closes: number[] = [];
      let avgVolume = Number(quote.averageDailyVolume3Month ?? NaN);

      try {
        const chart = await axios.get<{
          chart?: {
            result?: Array<{
              indicators?: { quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }> };
            }>;
          };
        }>(`${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}`, {
          params: { range: "3mo", interval: "1d" },
          timeout: 20_000,
        });

        const quoteSeries = chart.data.chart?.result?.[0]?.indicators?.quote?.[0];
        closes = (quoteSeries?.close ?? []).filter((v): v is number => typeof v === "number");
        const volumes = (quoteSeries?.volume ?? []).filter((v): v is number => typeof v === "number");

        if (volumes.length > 0) {
          const volumeSlice = volumes.slice(-30);
          const sum = volumeSlice.reduce((acc, v) => acc + v, 0);
          avgVolume = sum / volumeSlice.length;
        }
      } catch {
        closes = [];
      }

      const rsi = calculateRsi(closes);
      const macdData = calculateMacd(closes);
      const volumenPromedio = Number.isFinite(avgVolume) && avgVolume > 0 ? avgVolume : null;
      const volumenAnomalo =
        volumenPromedio !== null && volumenActual > 0 ? volumenActual >= volumenPromedio * 2 : false;

      const senal = signalFromRsi(rsi);
      const score = scoreAccion(rsi, volumenAnomalo, macdData.cruce);

      const item: AccionOpportunity = {
        ticker,
        nombre,
        senal,
        precioActual,
        precioObjetivo,
        rsi,
        macd: macdData.macd,
        macdSignal: macdData.signal,
        macdCruce: macdData.cruce,
        volumenAnomalo,
        volumenActual: volumenActual > 0 ? volumenActual : null,
        volumenPromedio,
        sector,
        mercado,
        score,
        detectadoAt,
        alertaEnviada: false,
      };

      return item;
    }),
  );

  const filtered = opportunities
    .filter((item) => item.ticker.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const db = getSupabaseClient();
  await db.from("inv_acciones").insert(
    filtered.map((item) => ({
      ticker: item.ticker,
      nombre: item.nombre,
      "señal": item.senal,
      precio_actual: item.precioActual,
      precio_objetivo: item.precioObjetivo,
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

  return filtered;
}


export const accionesRadar: RadarConfig = {
  key: "inv_acciones",
  name: "Radar Acciones",
  description: "Monitorea señales RSI/MACD/volumen en tickers objetivo.",
  isActive: false,
  priority: 5,
  scheduleMinutes: 1440,
  minScore: 0,
  includeTerms: ["acciones", "rsi", "macd", "volumen"],
  excludeTerms: [],
  geoTerms: [],
  entityTerms: ["AAPL", "MSFT", "NVDA", "AMZN", "PE&OLES"],
  rules: [
    {
      ruleType: "keyword",
      fieldName: "canonical_text",
      operator: "any_of",
      value: ["acciones", "rsi", "macd"],
      weight: 1,
      isRequired: false,
    },
  ],
};
