import axios from "axios";
import * as cheerio from "cheerio";
import type { AuctionOpportunity, SubastasCollectorResult } from "./index";

export const GOVPLANET_BASE_URL = "https://www.govplanet.com";

function parsePrice(text: string): number | null {
  const normalized = text.replace(/[^\d.,]/g, "").replace(/,/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function absoluteUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  return `${GOVPLANET_BASE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function textFromFirst($: cheerio.Root, selectors: string[]): string {
  for (const selector of selectors) {
    const value = $(selector).first().text().trim();
    if (value) return value;
  }
  return "";
}

export async function collectGovPlanet(): Promise<SubastasCollectorResult> {
  const errors: string[] = [];
  const opportunities: AuctionOpportunity[] = [];

  try {
    const listingResponse = await axios.get<string>(
      `${GOVPLANET_BASE_URL}/jsp/s/search.ips`,
      { timeout: 20_000 },
    );

    const $list = cheerio.load(listingResponse.data);
    const cards = $list(".searchResults .item, .ci, .search-result-item").slice(0, 25);

    for (const card of cards.toArray()) {
      try {
        const node = $list(card);
        const href =
          node.find("a[href]").first().attr("href") ??
          node.attr("data-url") ??
          "";

        if (!href) continue;

        const url = absoluteUrl(href);

        const detailResponse = await axios.get<string>(url, { timeout: 20_000 });
        const $detail = cheerio.load(detailResponse.data);

        const title =
          textFromFirst($detail, ["h1", ".lotTitle", ".itemTitle"]) ||
          node.find("a[href]").first().text().trim() ||
          "Sin título";

        const description =
          textFromFirst($detail, [
            ".description",
            "#description",
            "[data-testid='item-description']",
          ]) || "Descripción no disponible";

        const currentPriceText =
          textFromFirst($detail, [".currentBid", ".price", ".bidAmount"]) ||
          node.find(".currentBid, .price").first().text().trim();

        const activeBidsText = textFromFirst($detail, [".numberOfBids", ".bidCount"]);
        const activeBids = Number(activeBidsText.replace(/[^\d]/g, ""));

        const closeAt =
          textFromFirst($detail, [".closingTime", ".timeRemaining", "[data-endtime]"]) ||
          null;

        const phone =
          textFromFirst($detail, ["a[href^='tel:']", ".contact-phone"]) ||
          "Ver en sitio";
        const email =
          textFromFirst($detail, ["a[href^='mailto:']", ".contact-email"]) ||
          "Ver en sitio";

        const address =
          textFromFirst($detail, [
            ".auctionHouseAddress",
            ".seller-address",
            ".contact-address",
          ]) || "Ver en sitio";

        const deposit =
          textFromFirst($detail, [".deposit", ".depositRequired"]) || "No especificado";

        const location =
          textFromFirst($detail, [".itemLocation", ".location", "[data-testid='location']"]) ||
          "Ver en sitio";

        const registrationHint = $detail.root().text().toLowerCase();
        const requiresRegistration =
          registrationHint.includes("register") ||
          registrationHint.includes("registration") ||
          registrationHint.includes("crear cuenta");

        opportunities.push({
          source: "govplanet",
          sourceLabel: "GovPlanet",
          countryEmoji: "🇺🇸",
          title,
          description,
          currentPrice: parsePrice(currentPriceText),
          marketEstimate: null,
          activeBids: Number.isFinite(activeBids) ? activeBids : null,
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
        errors.push(`GovPlanet detalle: ${message}`);
      }
    }
  } catch (listingErr) {
    const message = listingErr instanceof Error ? listingErr.message : String(listingErr);
    errors.push(`GovPlanet listado: ${message}`);
  }

  return {
    source: "govplanet",
    sourceLabel: "GovPlanet",
    opportunities,
    errors,
  };
}
