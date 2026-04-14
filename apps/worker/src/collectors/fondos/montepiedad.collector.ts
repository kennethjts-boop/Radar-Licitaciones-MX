/**
 * MONTE DE PIEDAD COLLECTOR — Inversión Social Monte de Piedad
 * URL: https://inversionsocial.montepiedad.com.mx/convocatorias/
 *
 * Scraper estático con axios + cheerio.
 */
import axios from "axios";
import * as cheerio from "cheerio";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { normalize } from "../../normalizers/procurement.normalizer";
import type { NormalizedProcurement } from "../../types/procurement";

const log = createModuleLogger("collector-fondos-montepiedad");

export const MONTEPIEDAD_SOURCE_KEY = "fondos_montepiedad";
export const MONTEPIEDAD_BASE_URL =
  "https://inversionsocial.montepiedad.com.mx/convocatorias/";

export interface MontepiedadCollectResult {
  items: NormalizedProcurement[];
  errors: string[];
  startedAt: string;
  finishedAt: string;
}

export async function collectMontepiedad(): Promise<MontepiedadCollectResult> {
  const startedAt = nowISO();
  const errors: string[] = [];
  const items: NormalizedProcurement[] = [];

  try {
    log.info(
      { url: MONTEPIEDAD_BASE_URL },
      "Iniciando scrape Monte de Piedad convocatorias",
    );

    const response = await axios.get<string>(MONTEPIEDAD_BASE_URL, {
      timeout: 15_000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; RadarLicitacionesMX/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      responseType: "text",
    });

    const $ = cheerio.load(response.data);

    const convocatorias: Array<{
      title: string;
      href: string;
      description: string;
      vigencia: string;
    }> = [];

    // Estrategia 1: cards/artículos de convocatorias
    $(
      "article, .convocatoria, .convocatoria-item, .card, .item, .post, .entry",
    ).each((_, el) => {
      const titleEl = $(el)
        .find("h2 a, h3 a, h4 a, .titulo a, .title a, .card-title a, a")
        .first();
      const title =
        titleEl.text().trim() ||
        $(el)
          .find("h2, h3, h4, .titulo, .title, .card-title, strong")
          .first()
          .text()
          .trim();

      if (!title || title.length < 5) return;

      const href =
        titleEl.attr("href") ||
        $(el).find("a").first().attr("href") ||
        MONTEPIEDAD_BASE_URL;
      const sourceUrl = href.startsWith("http")
        ? href
        : `https://inversionsocial.montepiedad.com.mx${href.startsWith("/") ? href : "/" + href}`;

      const description = $(el)
        .find("p, .description, .descripcion, .excerpt, .card-text")
        .first()
        .text()
        .trim();
      const vigencia = $(el)
        .find(".vigencia, .deadline, .date, time, .fecha")
        .first()
        .text()
        .trim();

      convocatorias.push({ title, href: sourceUrl, description, vigencia });
    });

    // Estrategia 2: tablas
    if (convocatorias.length === 0) {
      $("table tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length === 0) return;

        const linkEl = cells.eq(0).find("a").first();
        const title = linkEl.text().trim() || cells.eq(0).text().trim();
        if (!title || title.length < 5) return;

        const href = linkEl.attr("href") || MONTEPIEDAD_BASE_URL;
        const sourceUrl = href.startsWith("http")
          ? href
          : `https://inversionsocial.montepiedad.com.mx${href.startsWith("/") ? href : "/" + href}`;

        const description = cells.eq(1).text().trim();
        const vigencia = cells.length >= 3 ? cells.eq(2).text().trim() : "";

        convocatorias.push({ title, href: sourceUrl, description, vigencia });
      });
    }

    // Estrategia 3: cualquier enlace descargable o de detalle
    if (convocatorias.length === 0) {
      $("a").each((_, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr("href") || "";
        if (!title || title.length < 10) return;
        if (!href || href === "#") return;

        const sourceUrl = href.startsWith("http")
          ? href
          : `https://inversionsocial.montepiedad.com.mx${href.startsWith("/") ? href : "/" + href}`;

        convocatorias.push({ title, href: sourceUrl, description: "", vigencia: "" });
      });
    }

    log.info(
      { count: convocatorias.length },
      "Convocatorias Monte de Piedad encontradas",
    );

    for (const conv of convocatorias) {
      const externalId = `montepiedad_${Buffer.from(conv.href).toString("base64").slice(0, 24)}`;

      items.push(
        normalize({
          source: MONTEPIEDAD_SOURCE_KEY,
          sourceUrl: conv.href,
          externalId,
          title: conv.title,
          description:
            [conv.description, conv.vigencia ? `Vigencia: ${conv.vigencia}` : ""]
              .filter(Boolean)
              .join(" | ") || null,
          dependencyName:
            "Nacional Monte de Piedad — Inversión Social Convocatorias",
          status: "activa",
          rawJson: {
            title: conv.title,
            href: conv.href,
            description: conv.description,
            vigencia: conv.vigencia,
            scrapedAt: startedAt,
          },
        }),
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(
      { err, url: MONTEPIEDAD_BASE_URL },
      "Error scrapeando Monte de Piedad fondos",
    );
    errors.push(`Monte de Piedad scrape error: ${msg}`);
  }

  return { items, errors, startedAt, finishedAt: nowISO() };
}
