import type { RadarConfig } from "../types/procurement";
import {
  collectAllSubastas,
  type AuctionOpportunity,
  type SubastasCollectorResult,
} from "../collectors/subastas";

export interface RankedAuctionOpportunity extends AuctionOpportunity {
  score: number;
  scoreBreakdown: {
    priceVsMarket: number;
    lowCompetition: number;
    urgency: number;
    contactCompleteness: number;
  };
  marketEstimateResolved: number | null;
  discountPct: number | null;
  hoursToClose: number | null;
  logisticsSummary: string;
  requirementsSummary: string;
  scoreExplanation: string;
}

export interface SubastasRadarResult {
  scannedTotal: number;
  top10: RankedAuctionOpportunity[];
  collectors: SubastasCollectorResult[];
}

const FALLBACK_MARKET_MULTIPLIER = 1.35;

function parseDateLike(value: string | null): Date | null {
  if (!value) return null;

  const isoCandidate = new Date(value);
  if (!Number.isNaN(isoCandidate.getTime())) return isoCandidate;

  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/, "$3-$2-$1");
  const secondTry = new Date(normalized);
  return Number.isNaN(secondTry.getTime()) ? null : secondTry;
}

function hoursUntilClose(closeAt: string | null): number | null {
  const closeDate = parseDateLike(closeAt);
  if (!closeDate) return null;

  const diffMs = closeDate.getTime() - Date.now();
  return diffMs > 0 ? diffMs / (1000 * 60 * 60) : null;
}

function hasContactData(item: AuctionOpportunity): boolean {
  const fields = [item.contactPhone, item.contactEmail, item.auctionHouseAddress];
  return fields.some((value) => value.trim().length > 0 && value.trim().toLowerCase() !== "ver en sitio");
}

function resolveMarketEstimate(item: AuctionOpportunity): number | null {
  if (item.marketEstimate && item.marketEstimate > 0) return item.marketEstimate;
  if (item.currentPrice && item.currentPrice > 0) return item.currentPrice * FALLBACK_MARKET_MULTIPLIER;
  return null;
}

function computePriceScore(item: AuctionOpportunity): number {
  const current = item.currentPrice;
  const market = resolveMarketEstimate(item);

  if (!current || !market || market <= 0) return 8;

  const discountRatio = (market - current) / market;
  if (discountRatio <= 0) return 4;

  return Math.min(45, Math.round(discountRatio * 70));
}

function computeCompetitionScore(item: AuctionOpportunity): number {
  if (item.activeBids === null) return 8;
  if (item.activeBids <= 1) return 28;
  if (item.activeBids <= 3) return 22;
  if (item.activeBids <= 6) return 14;
  if (item.activeBids <= 10) return 8;
  return 3;
}

function computeUrgencyScore(item: AuctionOpportunity): number {
  const hours = hoursUntilClose(item.closeAt);
  if (hours === null) return 6;
  if (hours <= 6) return 26;
  if (hours <= 12) return 24;
  if (hours <= 24) return 20;
  if (hours <= 48) return 14;
  if (hours <= 72) return 10;
  return 5;
}

function computeContactScore(item: AuctionOpportunity): number {
  if (!hasContactData(item)) return 2;

  let score = 0;
  if (item.contactPhone.trim() && item.contactPhone.trim().toLowerCase() !== "ver en sitio") score += 8;
  if (item.contactEmail.trim() && item.contactEmail.trim().toLowerCase() !== "ver en sitio") score += 7;
  if (item.auctionHouseAddress.trim() && item.auctionHouseAddress.trim().toLowerCase() !== "ver en sitio") score += 5;
  return Math.min(20, score);
}

function resolveTransportRequirement(item: AuctionOpportunity): string {
  const hayDireccion = item.auctionHouseAddress.trim().length > 0;
  if (hayDireccion || item.location.trim().length > 0) {
    return "Retiro en sitio probable; validar proveedor de transporte";
  }
  return "Logística no especificada";
}

function resolveRequirements(item: AuctionOpportunity): string {
  const requirements: string[] = [];
  requirements.push(item.requiresRegistration ? "Registro previo obligatorio" : "Registro previo recomendado");

  const deposit = item.requiredDeposit.trim();
  if (deposit.length > 0 && deposit.toLowerCase() !== "n/a") {
    requirements.push(`Depósito: ${deposit}`);
  } else {
    requirements.push("Depósito: por confirmar");
  }

  requirements.push("Documentación: identificación oficial + datos fiscales/comprador");
  return requirements.join(" | ");
}

function scoreOpportunity(item: AuctionOpportunity): RankedAuctionOpportunity {
  const priceVsMarket = computePriceScore(item);
  const lowCompetition = computeCompetitionScore(item);
  const urgency = computeUrgencyScore(item);
  const contactCompleteness = computeContactScore(item);

  const score = Math.max(0, Math.min(100, priceVsMarket + lowCompetition + urgency + contactCompleteness));
  const marketEstimateResolved = resolveMarketEstimate(item);
  const discountPct =
    item.currentPrice && marketEstimateResolved && marketEstimateResolved > 0
      ? ((marketEstimateResolved - item.currentPrice) / marketEstimateResolved) * 100
      : null;
  const hoursToClose = hoursUntilClose(item.closeAt);
  const logisticsSummary = resolveTransportRequirement(item);
  const requirementsSummary = resolveRequirements(item);

  const explanation = [
    `descuento ${discountPct === null ? "N/D" : `${Math.max(discountPct, 0).toFixed(1)}%`}`,
    `${item.activeBids === null ? "pujas N/D" : `${item.activeBids} pujas`}`,
    `${hoursToClose === null ? "cierre N/D" : `cierra en ${Math.ceil(hoursToClose)}h`}`,
  ].join(", ");

  return {
    ...item,
    score,
    scoreBreakdown: {
      priceVsMarket,
      lowCompetition,
      urgency,
      contactCompleteness,
    },
    marketEstimateResolved,
    discountPct,
    hoursToClose,
    logisticsSummary,
    requirementsSummary,
    scoreExplanation: `Score ${score} — ${explanation}`,
  };
}

export function rankOpportunities(items: AuctionOpportunity[]): RankedAuctionOpportunity[] {
  return items
    .map((item) => scoreOpportunity(item))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

export async function runSubastasRadar(): Promise<SubastasRadarResult> {
  const collectors = await collectAllSubastas();
  const allOpportunities = collectors.flatMap((collector) => collector.opportunities);
  const top10 = rankOpportunities(allOpportunities);

  return {
    scannedTotal: allOpportunities.length,
    top10,
    collectors,
  };
}

export const subastasRadar: RadarConfig = {
  key: "subastas_top10",
  name: "Subastas USA + MX — Top 10",
  description:
    "Ranking diario de subastas en GovPlanet, Public Surplus, GSA e INDEP con score de oportunidad 0-100.",
  isActive: false,
  priority: 5,
  scheduleMinutes: 1440,
  minScore: 0,
  includeTerms: ["subasta", "auction", "govplanet", "publicsurplus", "gsa", "indep"],
  excludeTerms: [],
  geoTerms: ["USA", "México"],
  entityTerms: ["GovPlanet", "Public Surplus", "GSA", "INDEP"],
  rules: [
    {
      ruleType: "keyword",
      fieldName: "canonical_text",
      operator: "any_of",
      value: ["subasta", "auction", "puja"],
      weight: 1,
      isRequired: false,
    },
  ],
};
