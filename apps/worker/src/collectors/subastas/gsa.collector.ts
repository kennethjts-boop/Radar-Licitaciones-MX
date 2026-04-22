import axios from "axios";
import * as cheerio from "cheerio";
import type { AuctionOpportunity, SubastasCollectorResult } from "./index";

export const GSA_BASE_URL = "https://gsaauctions.gov";

function parsePrice(text: string): number | null {
  const normalized = text.replace(/[^\d.,]/g, "").replace(/,/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function absoluteUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  return `${GSA_BASE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function textFromFirst($: cheerio.Root, selectors: string[]): string {
  for (const selector of selectors) {
    const value = $(selector).first().text().trim();
    if (value) return value;
  }
  return "";
}

export async function collectGsaAuctions(): Promise<SubastasCollectorResult> {
  const errors: string[] = [];
  const opportunities: AuctionOpportunity[] = [];

  try {
    const listingResponse = await axios.get<string>(`${GSA_BASE_URL}/auctions/auctions-list`, {
      timeout: 20_000,
    });

    const $list = cheerio.load(listingResponse.data);
    const rows = $list(".table tr, .search-results .result-row, .auction-row").slice(0, 25);

    for (const row of rows.toArray()) {
      try {
        const node = $list(row);
        const href = node.find("a[href]").first().attr("href") ?? "";
        if (!href || href.includes("javascript:")) continue;

        const url = absoluteUrl(href);
        const detailResponse = await axios.get<string>(url, { timeout: 20_000 });
        const $detail = cheerio.load(detailResponse.data);

        const title =
          textFromFirst($detail, ["h1", ".lot-title", ".auction-title"]) ||
          node.find("a[href]").first().text().trim() ||
          "Sin título";

        const description =
          textFromFirst($detail, [".lot-description", "#description", ".description"]) ||
          "Descripción no disponible";

        const currentPriceText =
          textFromFirst($detail, [".current-bid", ".high-bid", ".price"]) || "";

        const activeBidsText = textFromFirst($detail, [".bid-count", ".number-bids"]);
        const activeBidsValue = Number(activeBidsText.replace(/[^\d]/g, ""));

        const closeAt =
          textFromFirst($detail, [".close-date", ".end-date", ".closing-time"]) || null;

        const location =
          textFromFirst($detail, [".city-state", ".location", ".item-location"]) ||
          "Ver en sitio";

        const phone =
          textFromFirst($detail, ["a[href^='tel:']", ".contact-phone", ".phone"]) ||
          "Ver en sitio";

        const email =
          textFromFirst($detail, ["a[href^='mailto:']", ".contact-email", ".email"]) ||
          "Ver en sitio";

        const address =
          textFromFirst($detail, [".contact-address", ".address", ".seller-address"]) ||
          "Ver en sitio";

        const deposit =
          textFromFirst($detail, [".deposit", ".deposit-required", ".payment-terms"]) ||
          "No especificado";

        const bodyText = $detail.root().text().toLowerCase();
        const requiresRegistration =
          bodyText.includes("register") ||
          bodyText.includes("registration") ||
          bodyText.includes("sam.gov");

        opportunities.push({
          source: "gsa",
          sourceLabel: "GSA Auctions",
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
        errors.push(`GSA detalle: ${message}`);
      }
    }
  } catch (listingErr) {
    const message = listingErr instanceof Error ? listingErr.message : String(listingErr);
    errors.push(`GSA listado: ${message}`);
  }

  return {
    source: "gsa",
    sourceLabel: "GSA Auctions",
    opportunities,
    errors,
  };
}
