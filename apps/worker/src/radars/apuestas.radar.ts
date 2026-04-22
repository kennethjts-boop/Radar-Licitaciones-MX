import type { RadarConfig } from "../types/procurement";
import axios from "axios";
import { getSupabaseClient } from "../storage/client";

export interface ApuestaOpportunity {
  deporte: string;
  liga: string;
  evento: string;
  equipoLocal: string;
  equipoVisitante: string;
  tipo: "arbitraje" | "predictivo";
  mercadoRecomendado: string;
  cuotaRecomendada: number;
  casaRecomendada: string;
  topCasas: Array<{ casa: string; cuota: number }>;
  probabilidadImplicitaPct: number;
  probabilidadModeladaPct: number;
  prediccionGanador: string;
  bttsPick: string;
  bttsProbPct: number | null;
  totalPick: string;
  totalProbPct: number | null;
  resultado1X2: string;
  valueBet: boolean;
  arbitrajeGarantizado: boolean;
  gananciaGarantizadaPct: number;
  stakeSugeridoA: number;
  stakeSugeridoB: number;
  casaA: string;
  cuotaA: number;
  casaB: string;
  cuotaB: number;
  confianza: "Alto" | "Medio" | "Bajo";
  liquidez: "Alta" | "Media" | "Baja";
  score: number;
  cierreAt: string;
  detectadoAt: string;
  alertaEnviada: boolean;
}

interface OddsOutcome {
  name: string;
  price: number;
}
interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}
interface OddsBookmaker {
  title: string;
  markets: OddsMarket[];
}
interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: OddsBookmaker[];
}

const SPORTS = ["soccer_mexico_ligamx", "soccer_spain_la_liga", "soccer_epl", "baseball_mlb"];
const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const BANKROLL = 1000;

function impliedProbability(price: number): number {
  return price > 0 ? 1 / price : 0;
}

function normalizeProbs(prices: number[]): number[] {
  const raw = prices.map((p) => impliedProbability(p));
  const sum = raw.reduce((acc, v) => acc + v, 0);
  if (sum <= 0) return prices.map(() => 0);
  return raw.map((v) => v / sum);
}

function calculateArbitrage(
  oddA: number,
  oddB: number,
): { isArb: boolean; profitPct: number; stakeA: number; stakeB: number } {
  const inverse = 1 / oddA + 1 / oddB;
  if (inverse >= 1) return { isArb: false, profitPct: 0, stakeA: 0, stakeB: 0 };

  const stakeA = BANKROLL * ((1 / oddA) / inverse);
  const stakeB = BANKROLL * ((1 / oddB) / inverse);
  const payout = BANKROLL / inverse;
  return { isArb: true, profitPct: ((payout - BANKROLL) / BANKROLL) * 100, stakeA, stakeB };
}

function confidenceFromEdge(edgePct: number, bookmakers: number): "Alto" | "Medio" | "Bajo" {
  if (edgePct >= 6 && bookmakers >= 6) return "Alto";
  if (edgePct >= 2 && bookmakers >= 3) return "Medio";
  return "Bajo";
}

function liquidityFromBooks(count: number): "Alta" | "Media" | "Baja" {
  if (count >= 8) return "Alta";
  if (count >= 4) return "Media";
  return "Baja";
}

function scoreOpportunity(edgePct: number, confidence: "Alto" | "Medio" | "Bajo", liquidity: "Alta" | "Media" | "Baja", arbPct: number): number {
  const confScore = confidence === "Alto" ? 35 : confidence === "Medio" ? 24 : 14;
  const liqScore = liquidity === "Alta" ? 25 : liquidity === "Media" ? 16 : 8;
  const edgeScore = Math.max(0, Math.min(30, Math.round(edgePct * 3)));
  const arbScore = arbPct > 0 ? Math.min(10, Math.round(arbPct * 2)) : 0;
  return Math.min(100, confScore + liqScore + edgeScore + arbScore);
}

export async function runApuestasRadar(): Promise<ApuestaOpportunity[]> {
  const apiKey = process.env.ODDS_API_KEY ?? "";
  if (!apiKey) return [];

  const detectadoAt = new Date().toISOString();
  const responses = await Promise.all(
    SPORTS.map((sport) =>
      axios
        .get<OddsEvent[]>(`${ODDS_API_BASE}/sports/${sport}/odds`, {
          params: {
            apiKey,
            regions: "us,eu",
            markets: "h2h,btts,totals",
            oddsFormat: "decimal",
          },
          timeout: 20_000,
        })
        .then((res) => ({ events: res.data }))
        .catch(() => ({ events: [] as OddsEvent[] })),
    ),
  );

  const found: ApuestaOpportunity[] = [];

  for (const { events } of responses) {
    for (const event of events) {
      const h2hRows: Array<{ team: string; price: number; book: string }> = [];
      const bttsRows: Array<{ name: string; price: number; book: string }> = [];
      const totalsRows: Array<{ name: string; price: number; book: string }> = [];

      for (const bookmaker of event.bookmakers ?? []) {
        for (const market of bookmaker.markets ?? []) {
          if (market.key === "h2h") {
            for (const outcome of market.outcomes ?? []) {
              h2hRows.push({ team: outcome.name, price: outcome.price, book: bookmaker.title });
            }
          }
          if (market.key === "btts") {
            for (const outcome of market.outcomes ?? []) {
              bttsRows.push({ name: outcome.name, price: outcome.price, book: bookmaker.title });
            }
          }
          if (market.key === "totals") {
            for (const outcome of market.outcomes ?? []) {
              totalsRows.push({ name: outcome.name, price: outcome.price, book: bookmaker.title });
            }
          }
        }
      }

      const homeOdds = h2hRows.filter((r) => r.team === event.home_team).sort((a, b) => b.price - a.price).slice(0, 3);
      const awayOdds = h2hRows.filter((r) => r.team === event.away_team).sort((a, b) => b.price - a.price).slice(0, 3);
      if (homeOdds.length === 0 || awayOdds.length === 0) continue;

      const bestHome = homeOdds[0];
      const bestAway = awayOdds[0];
      const twoWay = normalizeProbs([bestHome.price, bestAway.price]);

      const modelHomePct = twoWay[0] * 100;
      const modelAwayPct = twoWay[1] * 100;
      const predWinner = modelHomePct >= modelAwayPct ? event.home_team : event.away_team;
      const predWinnerPct = Math.max(modelHomePct, modelAwayPct);
      const bestWinnerRow = predWinner === event.home_team ? bestHome : bestAway;
      const impliedWinnerPct = impliedProbability(bestWinnerRow.price) * 100;
      const edgePct = predWinnerPct - impliedWinnerPct;

      const bttsBestYes = bttsRows.filter((r) => /^yes$/i.test(r.name)).sort((a, b) => b.price - a.price)[0];
      const bttsBestNo = bttsRows.filter((r) => /^no$/i.test(r.name)).sort((a, b) => b.price - a.price)[0];
      const bttsNormalized = bttsBestYes && bttsBestNo ? normalizeProbs([bttsBestYes.price, bttsBestNo.price]) : null;
      const bttsPick = bttsNormalized ? (bttsNormalized[0] >= bttsNormalized[1] ? "Sí" : "No") : "N/D";
      const bttsProb = bttsNormalized ? Math.max(bttsNormalized[0], bttsNormalized[1]) * 100 : null;

      const over25 = totalsRows.find((r) => /over/i.test(r.name) && /2\.?5/.test(r.name));
      const under25 = totalsRows.find((r) => /under/i.test(r.name) && /2\.?5/.test(r.name));
      const totalsNormalized = over25 && under25 ? normalizeProbs([over25.price, under25.price]) : null;
      const totalPick = totalsNormalized ? (totalsNormalized[0] >= totalsNormalized[1] ? "Over 2.5" : "Under 2.5") : "N/D";
      const totalProb = totalsNormalized ? Math.max(totalsNormalized[0], totalsNormalized[1]) * 100 : null;

      const arb = calculateArbitrage(bestHome.price, bestAway.price);
      const confidence = confidenceFromEdge(edgePct, event.bookmakers?.length ?? 0);
      const liquidity = liquidityFromBooks(event.bookmakers?.length ?? 0);
      const score = scoreOpportunity(edgePct, confidence, liquidity, arb.profitPct);
      const isSoccer = event.sport_key.startsWith("soccer_");

      found.push({
        deporte: event.sport_key,
        liga: event.sport_title,
        evento: event.id,
        equipoLocal: event.home_team,
        equipoVisitante: event.away_team,
        tipo: arb.isArb ? "arbitraje" : "predictivo",
        mercadoRecomendado: isSoccer ? `1X2 — ${predWinner}` : `Moneyline — ${predWinner}`,
        cuotaRecomendada: bestWinnerRow.price,
        casaRecomendada: bestWinnerRow.book,
        topCasas: [bestWinnerRow, ...(predWinner === event.home_team ? homeOdds.slice(1) : awayOdds.slice(1))].map((x) => ({
          casa: x.book,
          cuota: x.price,
        })),
        probabilidadImplicitaPct: impliedWinnerPct,
        probabilidadModeladaPct: predWinnerPct,
        prediccionGanador: predWinner,
        bttsPick,
        bttsProbPct: bttsProb,
        totalPick,
        totalProbPct: totalProb,
        resultado1X2: `${event.home_team} ${modelHomePct.toFixed(1)}% vs ${event.away_team} ${modelAwayPct.toFixed(1)}%`,
        valueBet: edgePct > 0,
        arbitrajeGarantizado: arb.isArb,
        gananciaGarantizadaPct: arb.profitPct,
        stakeSugeridoA: arb.stakeA,
        stakeSugeridoB: arb.stakeB,
        casaA: bestHome.book,
        cuotaA: bestHome.price,
        casaB: bestAway.book,
        cuotaB: bestAway.price,
        confianza: confidence,
        liquidez: liquidity,
        score,
        cierreAt: event.commence_time,
        detectadoAt,
        alertaEnviada: false,
      });
    }
  }

  const top = found.sort((a, b) => b.score - a.score).slice(0, 10);

  const db = getSupabaseClient();
  if (top.length > 0) {
    await db.from("inv_apuestas").insert(
      top.map((item) => ({
        deporte: item.deporte,
        liga: item.liga,
        evento: item.evento,
        equipo_local: item.equipoLocal,
        equipo_visitante: item.equipoVisitante,
        casa_a: item.casaA,
        cuota_a: item.cuotaA,
        casa_b: item.casaB,
        cuota_b: item.cuotaB,
        tipo: item.tipo,
        ganancia_garantizada_pct: item.gananciaGarantizadaPct,
        stake_sugerido_a: item.stakeSugeridoA,
        stake_sugerido_b: item.stakeSugeridoB,
        score: item.score,
        cierre_at: item.cierreAt,
        detectado_at: item.detectadoAt,
        alerta_enviada: item.alertaEnviada,
      })),
    );
  }

  return top;
}

export const apuestasRadar: RadarConfig = {
  key: "inv_apuestas",
  name: "Radar Apuestas Predictivo + Arbitraje",
  description: "Detecta value bets con modelo implícito y marca arbitrajes garantizados cuando existan.",
  isActive: false,
  priority: 5,
  scheduleMinutes: 1440,
  minScore: 0,
  includeTerms: ["apuestas", "arbitraje", "odds", "value bet", "predictivo"],
  excludeTerms: [],
  geoTerms: [],
  entityTerms: ["ligamx", "mlb", "epl", "la liga"],
  rules: [
    {
      ruleType: "keyword",
      fieldName: "canonical_text",
      operator: "any_of",
      value: ["apuesta", "arbitraje", "cuota", "predicción"],
      weight: 1,
      isRequired: false,
    },
  ],
};
