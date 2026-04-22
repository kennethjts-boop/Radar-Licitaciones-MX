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
    closeWindow: number;
    contactCompleteness: number;
  };
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

function hasCompleteContactData(item: AuctionOpportunity): boolean {
  const requiredFields = [item.contactPhone, item.contactEmail, item.auctionHouseAddress];

  return requiredFields.every(
    (value) => value.trim().length > 0 && value.trim().toLowerCase() !== "ver en sitio",
  );
}

function resolveMarketEstimate(item: AuctionOpportunity): number | null {
  if (item.marketEstimate && item.marketEstimate > 0) {
    return item.marketEstimate;
  }

  if (item.currentPrice && item.currentPrice > 0) {
    return item.currentPrice * FALLBACK_MARKET_MULTIPLIER;
  }

  return null;
}

function computePriceScore(item: AuctionOpportunity): number {
  const current = item.currentPrice;
  const market = resolveMarketEstimate(item);

  if (!current || !market || market <= 0) return 10;

  const discountRatio = (market - current) / market;
  if (discountRatio <= 0) return 5;

  return Math.min(40, Math.round(discountRatio * 50));
}

function computeCompetitionScore(item: AuctionOpportunity): number {
  if (item.activeBids === null) return 10;
  if (item.activeBids <= 2) return 25;
  if (item.activeBids <= 5) return 18;
  if (item.activeBids <= 10) return 10;
  return 4;
}

function computeCloseWindowScore(item: AuctionOpportunity): number {
  const hours = hoursUntilClose(item.closeAt);
  if (hours === null) return 6;
  if (hours >= 48 && hours <= 72) return 20;
  if (hours > 24 && hours < 48) return 14;
  if (hours > 72 && hours <= 96) return 12;
  if (hours <= 24) return 10;
  return 5;
}

function computeContactScore(item: AuctionOpportunity): number {
  return hasCompleteContactData(item) ? 15 : 0;
}

function scoreOpportunity(item: AuctionOpportunity): RankedAuctionOpportunity {
  const priceVsMarket = computePriceScore(item);
  const lowCompetition = computeCompetitionScore(item);
  const closeWindow = computeCloseWindowScore(item);
  const contactCompleteness = computeContactScore(item);

  const score = Math.max(
    0,
    Math.min(100, priceVsMarket + lowCompetition + closeWindow + contactCompleteness),
  );

  return {
    ...item,
    score,
    scoreBreakdown: {
      priceVsMarket,
      lowCompetition,
      closeWindow,
      contactCompleteness,
    },
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
