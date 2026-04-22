import axios from "axios";
import * as cheerio from "cheerio";
import type { AuctionOpportunity, SubastasCollectorResult } from "./index";

export const PUBLIC_SURPLUS_BASE_URL = "https://www.publicsurplus.com";

function parsePrice(text: string): number | null {
  const normalized = text.replace(/[^\d.,]/g, "").replace(/,/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function absoluteUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  return `${PUBLIC_SURPLUS_BASE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function textFromFirst($: cheerio.Root, selectors: string[]): string {
  for (const selector of selectors) {
    const value = $(selector).first().text().trim();
    if (value) return value;
  }
  return "";
}

export async function collectPublicSurplus(): Promise<SubastasCollectorResult> {
  const errors: string[] = [];
  const opportunities: AuctionOpportunity[] = [];

  try {
    const listingResponse = await axios.get<string>(
      `${PUBLIC_SURPLUS_BASE_URL}/sms/browse/home`,
      { timeout: 20_000 },
    );

    const $list = cheerio.load(listingResponse.data);
    const rows = $list("table tr, .auction-item, .search-result").slice(0, 25);

    for (const row of rows.toArray()) {
      try {
        const node = $list(row);
        const href = node.find("a[href]").first().attr("href") ?? "";
        if (!href || href.includes("javascript:")) continue;

        const url = absoluteUrl(href);
        const detailResponse = await axios.get<string>(url, { timeout: 20_000 });
        const $detail = cheerio.load(detailResponse.data);

        const title =
          textFromFirst($detail, ["h1", ".pageTitle", ".auctionTitle"]) ||
          node.find("a[href]").first().text().trim() ||
          "Sin título";

        const description =
          textFromFirst($detail, [".description", "#auctionDescription", "#description"]) ||
          "Descripción no disponible";

        const currentPriceText =
          textFromFirst($detail, [".currentBid", ".highBid", ".price"]) || "";

        const closeAt =
          textFromFirst($detail, [".endDate", ".auctionClosing", ".close-date"]) || null;

        const location =
          textFromFirst($detail, [".location", ".itemLocation", "#location"]) ||
          "Ver en sitio";

        const phone =
          textFromFirst($detail, ["a[href^='tel:']", ".contactPhone", ".phone"]) ||
          "Ver en sitio";

        const email =
          textFromFirst($detail, ["a[href^='mailto:']", ".contactEmail", ".email"]) ||
          "Ver en sitio";

        const address =
          textFromFirst($detail, [".sellerAddress", ".contactAddress", ".address"]) ||
          "Ver en sitio";

        const deposit =
          textFromFirst($detail, [".deposit", ".depositRequired", ".buyerPremium"]) ||
          "No especificado";

        const activeBidsText = textFromFirst($detail, [".bidCount", ".numberOfBids"]);
        const activeBidsValue = Number(activeBidsText.replace(/[^\d]/g, ""));

        const bodyText = $detail.root().text().toLowerCase();
        const requiresRegistration =
          bodyText.includes("register") ||
          bodyText.includes("registration") ||
          bodyText.includes("sign up");

        opportunities.push({
          source: "publicsurplus",
          sourceLabel: "Public Surplus",
          countryEmoji: "🇺🇸",
          title,
          description,
          currentPrice: parsePrice(currentPriceText),
          marketEstimate: null,
          activeBids: Number.isFinite(activeBidsValue) ? activeBidsValue : null,
          closeAt,
          location,
          contactPhone: phone,
          contactEmail: email,
          auctionHouseAddress: address,
          url,
          requiresRegistration,
          requiredDeposit: deposit,
        });
      } catch (detailErr) {
        const message =
          detailErr instanceof Error ? detailErr.message : String(detailErr);
        errors.push(`Public Surplus detalle: ${message}`);
      }
    }
  } catch (listingErr) {
    const message = listingErr instanceof Error ? listingErr.message : String(listingErr);
    errors.push(`Public Surplus listado: ${message}`);
  }

  return {
    source: "publicsurplus",
    sourceLabel: "Public Surplus",
    opportunities,
    errors,
  };
}
