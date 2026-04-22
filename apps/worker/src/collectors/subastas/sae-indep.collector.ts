import axios from "axios";
import * as cheerio from "cheerio";
import type { AuctionOpportunity, SubastasCollectorResult } from "./index";

export const INDEP_BASE_URL = "https://www.indep.gob.mx";

function parsePrice(text: string): number | null {
  const normalized = text.replace(/[^\d.,]/g, "").replace(/,/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function absoluteUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  return `${INDEP_BASE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function textFromFirst($: cheerio.Root, selectors: string[]): string {
  for (const selector of selectors) {
    const value = $(selector).first().text().trim();
    if (value) return value;
  }
  return "";
}

export async function collectSaeIndep(): Promise<SubastasCollectorResult> {
  const errors: string[] = [];
  const opportunities: AuctionOpportunity[] = [];

  try {
    const listingResponse = await axios.get<string>(`${INDEP_BASE_URL}/subastas`, {
      timeout: 20_000,
    });

    const $list = cheerio.load(listingResponse.data);
    const cards = $list(".subasta-item, .card, .resultado, article").slice(0, 25);

    for (const card of cards.toArray()) {
      try {
        const node = $list(card);
        const href = node.find("a[href]").first().attr("href") ?? "";
        if (!href || href.includes("javascript:")) continue;

        const url = absoluteUrl(href);
        const detailResponse = await axios.get<string>(url, { timeout: 20_000 });
        const $detail = cheerio.load(detailResponse.data);

        const title =
          textFromFirst($detail, ["h1", ".titulo-subasta", ".entry-title"]) ||
          node.find("a[href]").first().text().trim() ||
          "Sin título";

        const description =
          textFromFirst($detail, [".descripcion", ".entry-content", "#descripcion"]) ||
          "Descripción no disponible";

        const currentPriceText =
          textFromFirst($detail, [".precio-actual", ".price", ".monto"]) || "";

        const activeBidsText = textFromFirst($detail, [".num-pujas", ".bid-count"]);
        const activeBidsValue = Number(activeBidsText.replace(/[^\d]/g, ""));

        const closeAt =
          textFromFirst($detail, [".fecha-cierre", ".closing-date", ".vencimiento"]) ||
          null;

        const location =
          textFromFirst($detail, [".ubicacion", ".location", ".direccion-bien"]) ||
          "Ver en sitio";

        const phone =
          textFromFirst($detail, ["a[href^='tel:']", ".telefono", ".contact-phone"]) ||
          "Ver en sitio";

        const email =
          textFromFirst($detail, ["a[href^='mailto:']", ".correo", ".contact-email"]) ||
          "Ver en sitio";

        const address =
          textFromFirst($detail, [".direccion-casa", ".direccion-contacto", ".address"]) ||
          "Ver en sitio";

        const deposit =
          textFromFirst($detail, [".deposito", ".garantia", ".deposit-required"]) ||
          "No especificado";

        const bodyText = $detail.root().text().toLowerCase();
        const requiresRegistration =
          bodyText.includes("registro") ||
          bodyText.includes("registrarse") ||
          bodyText.includes("cuenta");

        opportunities.push({
          source: "sae-indep",
          sourceLabel: "INDEP",
          countryEmoji: "🇲🇽",
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
        errors.push(`INDEP detalle: ${message}`);
      }
    }
  } catch (listingErr) {
    const message = listingErr instanceof Error ? listingErr.message : String(listingErr);
    errors.push(`INDEP listado: ${message}`);
  }

  return {
    source: "sae-indep",
    sourceLabel: "INDEP",
    opportunities,
    errors,
  };
}
