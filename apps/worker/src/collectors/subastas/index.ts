import { createModuleLogger } from "../../core/logger";
import { collectGovPlanet } from "./govplanet.collector";
import { collectPublicSurplus } from "./publicsurplus.collector";
import { collectGsaAuctions } from "./gsa.collector";
import { collectSaeIndep } from "./sae-indep.collector";

const log = createModuleLogger("subastas-collectors");

export type AuctionSource = "govplanet" | "publicsurplus" | "gsa" | "sae-indep";

export interface AuctionOpportunity {
  source: AuctionSource;
  sourceLabel: string;
  countryEmoji: "🇺🇸" | "🇲🇽";
  title: string;
  description: string;
  currentPrice: number | null;
  marketEstimate: number | null;
  activeBids: number | null;
  closeAt: string | null;
  location: string;
  contactPhone: string;
  contactEmail: string;
  auctionHouseAddress: string;
  url: string;
  requiresRegistration: boolean;
  requiredDeposit: string;
}

export interface SubastasCollectorResult {
  source: AuctionSource;
  sourceLabel: string;
  opportunities: AuctionOpportunity[];
  errors: string[];
}

export async function collectAllSubastas(): Promise<SubastasCollectorResult[]> {
  const tasks: Array<Promise<SubastasCollectorResult>> = [
    collectGovPlanet(),
    collectPublicSurplus(),
    collectGsaAuctions(),
    collectSaeIndep(),
  ];

  const settled = await Promise.allSettled(tasks);

  return settled.map((entry, index) => {
    if (entry.status === "fulfilled") {
      return entry.value;
    }

    const fallbackSource: AuctionSource[] = [
      "govplanet",
      "publicsurplus",
      "gsa",
      "sae-indep",
    ];

    const source = fallbackSource[index] ?? "govplanet";
    const message =
      entry.reason instanceof Error ? entry.reason.message : String(entry.reason);

    log.error({ source, err: message }, "Collector de subastas falló en ejecución");

    return {
      source,
      sourceLabel: source,
      opportunities: [],
      errors: [message],
    };
  });
}
