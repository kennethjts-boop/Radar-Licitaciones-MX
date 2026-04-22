import type { RadarConfig } from "../types/procurement";
import axios from "axios";
import { getSupabaseClient } from "../storage/client";

export interface PetroleoOpportunity {
  tipo: "WTI" | "BRENT";
  precio: number;
  cambioPct: number;
  precioSoporte: number;
  precioResistencia: number;
  senal: "compra" | "venta" | "alerta" | "neutral";
  evento: string;
  inventariosCambioPct: number | null;
  score: number;
  detectadoAt: string;
  alertaEnviada: boolean;
}

const ALPHA_URL = "https://www.alphavantage.co/query";
const EIA_URL = "https://api.eia.gov/v2/petroleum/stoc/wstk/data";

function scorePetroleo(item: {
  cambioPct: number;
  inventariosCambioPct: number | null;
  eventoOpep: boolean;
}): number {
  let score = 0;
  if (Math.abs(item.cambioPct) > 2) score += 40;
  if (item.eventoOpep) score += 25;
  if (item.inventariosCambioPct !== null && item.inventariosCambioPct <= -3) score += 35;
  return Math.min(100, score);
}

function signalPetroleo(item: {
  cambioPct: number;
  inventariosCambioPct: number | null;
  eventoOpep: boolean;
}): "compra" | "venta" | "alerta" | "neutral" {
  if (item.inventariosCambioPct !== null && item.inventariosCambioPct <= -3) return "compra";
  if (Math.abs(item.cambioPct) > 2 || item.eventoOpep) return "alerta";
  if (item.cambioPct < -2) return "venta";
  return "neutral";
}

async function fetchCommodity(functionName: "WTI" | "BRENT", apiKey: string): Promise<{ precio: number; cambioPct: number } | null> {
  const response = await axios.get<{ data?: Array<{ value?: string; date?: string }> }>(ALPHA_URL, {
    params: {
      function: functionName,
      interval: "weekly",
      apikey: apiKey,
    },
    timeout: 20_000,
  });

  const serie = response.data.data ?? [];
  const latest = Number(serie[0]?.value ?? NaN);
  const prev = Number(serie[1]?.value ?? NaN);

  if (!Number.isFinite(latest) || !Number.isFinite(prev) || prev === 0) {
    return null;
  }

  const cambioPct = ((latest - prev) / prev) * 100;
  return { precio: latest, cambioPct };
}

async function fetchInventoriesChangePct(apiKey: string): Promise<number | null> {
  const response = await axios.get<{ response?: { data?: Array<{ value?: string }> } }>(EIA_URL, {
    params: {
      api_key: apiKey,
      frequency: "weekly",
      data: ["value"],
      sort: "[{'column':'period','direction':'desc'}]",
      length: 2,
    },
    timeout: 20_000,
  });

  const rows = response.data.response?.data ?? [];
  const latest = Number(rows[0]?.value ?? NaN);
  const prev = Number(rows[1]?.value ?? NaN);
  if (!Number.isFinite(latest) || !Number.isFinite(prev) || prev === 0) return null;

  return ((latest - prev) / prev) * 100;
}

export async function runPetroleoRadar(): Promise<PetroleoOpportunity[]> {
  const alphaKey = process.env.ALPHA_VANTAGE_API_KEY ?? "";
  const eiaKey = process.env.EIA_API_KEY ?? "";

  const detectadoAt = new Date().toISOString();
  const [wti, brent, inventariosCambioPct] = await Promise.all([
    alphaKey ? fetchCommodity("WTI", alphaKey).catch(() => null) : Promise.resolve(null),
    alphaKey ? fetchCommodity("BRENT", alphaKey).catch(() => null) : Promise.resolve(null),
    eiaKey ? fetchInventoriesChangePct(eiaKey).catch(() => null) : Promise.resolve(null),
  ]);

  const eventoOpep = false;
  const evento = eventoOpep ? "Evento OPEP detectado" : "Sin evento OPEP";

  const baseData: Array<{ tipo: "WTI" | "BRENT"; precio: number; cambioPct: number }> = [];
  if (wti) baseData.push({ tipo: "WTI", precio: wti.precio, cambioPct: wti.cambioPct });
  if (brent) baseData.push({ tipo: "BRENT", precio: brent.precio, cambioPct: brent.cambioPct });

  const opportunities: PetroleoOpportunity[] = baseData.map((entry) => {
    const score = scorePetroleo({
      cambioPct: entry.cambioPct,
      inventariosCambioPct,
      eventoOpep,
    });

    const senal = signalPetroleo({
      cambioPct: entry.cambioPct,
      inventariosCambioPct,
      eventoOpep,
    });

    return {
      tipo: entry.tipo,
      precio: entry.precio,
      cambioPct: entry.cambioPct,
      precioSoporte: entry.precio * 0.97,
      precioResistencia: entry.precio * 1.03,
      senal,
      evento,
      inventariosCambioPct,
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
        cambio_pct: item.cambioPct,
        precio_soporte: item.precioSoporte,
        precio_resistencia: item.precioResistencia,
        "señal": item.senal,
        evento: item.evento,
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
  name: "Radar Petróleo",
  description: "Monitorea WTI/Brent, inventarios EIA y eventos OPEP.",
  isActive: false,
  priority: 5,
  scheduleMinutes: 10080,
  minScore: 0,
  includeTerms: ["petroleo", "wti", "brent", "eia", "opep"],
  excludeTerms: [],
  geoTerms: [],
  entityTerms: ["WTI", "BRENT", "EIA", "OPEP"],
  rules: [
    {
      ruleType: "keyword",
      fieldName: "canonical_text",
      operator: "any_of",
      value: ["petroleo", "wti", "brent"],
      weight: 1,
      isRequired: false,
    },
  ],
};
