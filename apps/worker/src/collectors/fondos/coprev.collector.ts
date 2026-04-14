/**
 * COPREV COLLECTOR — COPREV Financiamiento
 * URL: https://coprev.com.mx/financiamiento/
 *
 * Scraper estático con axios + cheerio.
 */
import axios from "axios";
import * as cheerio from "cheerio";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { normalize } from "../../normalizers/procurement.normalizer";
import type { NormalizedProcurement } from "../../types/procurement";

const log = createModuleLogger("collector-fondos-coprev");

export const COPREV_SOURCE_KEY = "fondos_coprev";
export const COPREV_BASE_URL = "https://coprev.com.mx/financiamiento/";

export interface CoprevCollectResult {
  items: NormalizedProcurement[];
  errors: string[];
  startedAt: string;
  finishedAt: string;
}

export async function collectCoprev(): Promise<CoprevCollectResult> {
  const startedAt = nowISO();
  const errors: string[] = [];
  const items: NormalizedProcurement[] = [];

  try {
    log.info({ url: COPREV_BASE_URL }, "Iniciando scrape COPREV financiamiento");

    const response = await axios.get<string>(COPREV_BASE_URL, {
      timeout: 15_000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; RadarLicitacionesMX/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      responseType: "text",
    });

    const $ = cheerio.load(response.data);

    const fondos: Array<{
      title: string;
      href: string;
      description: string;
      vigencia: string;
    }> = [];

    // Estrategia 1: secciones/artículos de financiamiento
    $(
      "article, .fondo, .financiamiento, .programa, .item, .card, .entry, section.financiamiento",
    ).each((_, el) => {
      const titleEl = $(el)
        .find("h2 a, h3 a, h4 a, .titulo a, .title a, a")
        .first();
      const title =
        titleEl.text().trim() ||
        $(el).find("h2, h3, h4, .titulo, .title, strong").first().text().trim();

      if (!title || title.length < 5) return;

      const href =
        titleEl.attr("href") ||
        $(el).find("a").first().attr("href") ||
        COPREV_BASE_URL;
      const sourceUrl = href.startsWith("http")
        ? href
        : `https://coprev.com.mx${href.startsWith("/") ? href : "/" + href}`;

      const description = $(el)
        .find("p, .description, .descripcion, .excerpt")
        .first()
        .text()
        .trim();
      const vigencia = $(el)
        .find(".vigencia, .deadline, .date, time")
        .first()
        .text()
        .trim();

      fondos.push({ title, href: sourceUrl, description, vigencia });
    });

    // Estrategia 2: tablas
    if (fondos.length === 0) {
      $("table tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length === 0) return;

        const linkEl = cells.eq(0).find("a").first();
        const title = linkEl.text().trim() || cells.eq(0).text().trim();
        if (!title || title.length < 5) return;

        const href = linkEl.attr("href") || COPREV_BASE_URL;
        const sourceUrl = href.startsWith("http")
          ? href
          : `https://coprev.com.mx${href.startsWith("/") ? href : "/" + href}`;

        const description = cells.eq(1).text().trim();
        const vigencia = cells.length >= 3 ? cells.eq(2).text().trim() : "";

        fondos.push({ title, href: sourceUrl, description, vigencia });
      });
    }

    // Estrategia 3: headings con links en la página
    if (fondos.length === 0) {
      $("h2, h3, h4").each((_, el) => {
        const linkEl = $(el).find("a").first();
        const title = $(el).text().trim();
        if (!title || title.length < 5) return;

        const href = linkEl.attr("href") || COPREV_BASE_URL;
        const sourceUrl = href.startsWith("http")
          ? href
          : `https://coprev.com.mx${href.startsWith("/") ? href : "/" + href}`;

        const description = $(el).next("p").text().trim();

        fondos.push({ title, href: sourceUrl, description, vigencia: "" });
      });
    }

    log.info({ count: fondos.length }, "Fondos COPREV encontrados");

    for (const fondo of fondos) {
      const externalId = `coprev_${Buffer.from(fondo.href).toString("base64").slice(0, 24)}`;

      items.push(
        normalize({
          source: COPREV_SOURCE_KEY,
          sourceUrl: fondo.href,
          externalId,
          title: fondo.title,
          description:
            [fondo.description, fondo.vigencia ? `Vigencia: ${fondo.vigencia}` : ""]
              .filter(Boolean)
              .join(" | ") || null,
          dependencyName: "COPREV — Financiamiento para OSC",
          status: "activa",
          rawJson: {
            title: fondo.title,
            href: fondo.href,
            description: fondo.description,
            vigencia: fondo.vigencia,
            scrapedAt: startedAt,
          },
        }),
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, url: COPREV_BASE_URL }, "Error scrapeando COPREV fondos");
    errors.push(`COPREV scrape error: ${msg}`);
  }

  return { items, errors, startedAt, finishedAt: nowISO() };
}
