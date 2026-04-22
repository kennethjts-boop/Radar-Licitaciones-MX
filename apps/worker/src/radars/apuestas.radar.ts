import type { RadarConfig } from "../types/procurement";
import axios from "axios";
import { getSupabaseClient } from "../storage/client";

export interface ApuestaOpportunity {
  deporte: string;
  liga: string;
  evento: string;
  equipoLocal: string;
  equipoVisitante: string;
  casaA: string;
  cuotaA: number;
  casaB: string;
  cuotaB: number;
  tipo: "arbitraje";
  gananciaGarantizadaPct: number;
  stakeSugeridoA: number;
  stakeSugeridoB: number;
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
  sport_title: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: OddsBookmaker[];
}

const SPORTS = ["soccer_mexico_ligamx", "baseball_mlb", "tennis_atp"];
const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const BANKROLL = 1000;

function scoreFromProfit(profitPct: number): number {
  if (profitPct > 5) return 100;
  if (profitPct >= 3) return 70;
  if (profitPct >= 1) return 40;
  return 0;
}

function calculateArbitrage(
  oddA: number,
  oddB: number,
): { isArb: boolean; profitPct: number; stakeA: number; stakeB: number } {
  const inverse = 1 / oddA + 1 / oddB;
  if (inverse >= 1) {
    return { isArb: false, profitPct: 0, stakeA: 0, stakeB: 0 };
  }

  const stakeA = BANKROLL * ((1 / oddA) / inverse);
  const stakeB = BANKROLL * ((1 / oddB) / inverse);
  const payout = BANKROLL / inverse;
  const profitPct = ((payout - BANKROLL) / BANKROLL) * 100;

  return { isArb: true, profitPct, stakeA, stakeB };
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
            markets: "h2h",
            oddsFormat: "decimal",
          },
          timeout: 20_000,
        })
        .then((res) => ({ sport, events: res.data }))
        .catch(() => ({ sport, events: [] as OddsEvent[] })),
    ),
  );

  const found: ApuestaOpportunity[] = [];

  for (const { sport, events } of responses) {
    for (const event of events) {
      const bestByTeam = new Map<string, { price: number; book: string }>();

      for (const bookmaker of event.bookmakers ?? []) {
        const market = bookmaker.markets?.find((m) => m.key === "h2h");
        if (!market) continue;

        for (const outcome of market.outcomes ?? []) {
          const current = bestByTeam.get(outcome.name);
          if (!current || outcome.price > current.price) {
            bestByTeam.set(outcome.name, { price: outcome.price, book: bookmaker.title });
          }
        }
      }

      const localName = event.home_team;
      const awayName = event.away_team;
      const oddLocal = bestByTeam.get(localName);
      const oddAway = bestByTeam.get(awayName);

      if (!oddLocal || !oddAway) continue;
      if (oddLocal.book === oddAway.book) continue;

      const arb = calculateArbitrage(oddLocal.price, oddAway.price);
      if (!arb.isArb) continue;

      const score = scoreFromProfit(arb.profitPct);
      if (score <= 0) continue;

      found.push({
        deporte: sport,
        liga: event.sport_title,
        evento: event.id,
        equipoLocal: localName,
        equipoVisitante: awayName,
        casaA: oddLocal.book,
        cuotaA: oddLocal.price,
        casaB: oddAway.book,
        cuotaB: oddAway.price,
        tipo: "arbitraje",
        gananciaGarantizadaPct: arb.profitPct,
        stakeSugeridoA: arb.stakeA,
        stakeSugeridoB: arb.stakeB,
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
  name: "Radar Apuestas Arbitraje",
  description: "Detecta oportunidades de arbitraje en cuotas deportivas.",
  isActive: false,
  priority: 5,
  scheduleMinutes: 1440,
  minScore: 0,
  includeTerms: ["apuestas", "arbitraje", "odds"],
  excludeTerms: [],
  geoTerms: [],
  entityTerms: ["ligamx", "mlb", "atp"],
  rules: [
    {
      ruleType: "keyword",
      fieldName: "canonical_text",
      operator: "any_of",
      value: ["apuesta", "arbitraje", "cuota"],
      weight: 1,
      isRequired: false,
    },
  ],
};
