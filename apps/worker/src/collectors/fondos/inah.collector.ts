/**
 * INAH COLLECTOR — Instituto Nacional de Antropología e Historia
 * URL: https://procuraciondefondos.inah.gob.mx/publico/convocatorias.php
 *
 * Scraper estático con axios + cheerio. Sin Playwright.
 */
import axios from "axios";
import * as cheerio from "cheerio";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { normalize } from "../../normalizers/procurement.normalizer";
import type { NormalizedProcurement } from "../../types/procurement";

const log = createModuleLogger("collector-fondos-inah");

export const INAH_SOURCE_KEY = "fondos_inah";
export const INAH_BASE_URL =
  "https://procuraciondefondos.inah.gob.mx/publico/convocatorias.php";

export interface InahCollectResult {
  items: NormalizedProcurement[];
  errors: string[];
  startedAt: string;
  finishedAt: string;
}

export async function collectInah(): Promise<InahCollectResult> {
  const startedAt = nowISO();
  const errors: string[] = [];
  const items: NormalizedProcurement[] = [];

  try {
    log.info({ url: INAH_BASE_URL }, "Iniciando scrape INAH fondos");

    const response = await axios.get<string>(INAH_BASE_URL, {
      timeout: 15_000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; RadarLicitacionesMX/1.0; +https://radar-licitaciones.mx)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      responseType: "text",
    });

    const $ = cheerio.load(response.data);

    // INAH usa una tabla HTML con convocatorias — intentar múltiples selectores
    const rows: Array<{
      title: string;
      href: string;
      description: string;
      dateText: string;
    }> = [];

    // Estrategia 1: tabla con filas
    $("table tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length === 0) return;

      const titleCell = cells.eq(0);
      const linkEl = titleCell.find("a").first();
      const title = linkEl.text().trim() || titleCell.text().trim();
      if (!title || title.length < 5) return;

      const href = linkEl.attr("href") || "";
      const sourceUrl = href.startsWith("http")
        ? href
        : href
        ? `https://procuraciondefondos.inah.gob.mx/${href.replace(/^\//, "")}`
        : INAH_BASE_URL;

      const description = cells.eq(1).text().trim() || cells.eq(cells.length - 1).text().trim();
      const dateText = cells.length >= 3 ? cells.eq(2).text().trim() : "";

      rows.push({ title, href: sourceUrl, description, dateText });
    });

    // Estrategia 2: lista de artículos / divs si no encontramos tabla
    if (rows.length === 0) {
      $("article, .convocatoria, .item-convocatoria, li.convocatoria").each(
        (_, el) => {
          const titleEl = $(el).find("h2, h3, h4, .titulo, .title").first();
          const title = titleEl.text().trim();
          if (!title || title.length < 5) return;

          const linkEl = $(el).find("a").first();
          const href = linkEl.attr("href") || INAH_BASE_URL;
          const sourceUrl = href.startsWith("http")
            ? href
            : `https://procuraciondefondos.inah.gob.mx/${href.replace(/^\//, "")}`;

          const description = $(el).find("p, .descripcion, .description").first().text().trim();
          const dateText = $(el).find("time, .fecha, .date").first().text().trim();

          rows.push({ title, href: sourceUrl, description, dateText });
        },
      );
    }

    // Estrategia 3: cualquier enlace relevante en la página
    if (rows.length === 0) {
      $("a").each((_, el) => {
        const href = $(el).attr("href") || "";
        const title = $(el).text().trim();
        if (!title || title.length < 10) return;
        if (!href.includes("convocatoria") && !href.includes("fondo")) return;

        const sourceUrl = href.startsWith("http")
          ? href
          : `https://procuraciondefondos.inah.gob.mx/${href.replace(/^\//, "")}`;

        rows.push({ title, href: sourceUrl, description: "", dateText: "" });
      });
    }

    log.info({ count: rows.length }, "Convocatorias INAH encontradas");

    for (const row of rows) {
      const externalId = `inah_${Buffer.from(row.href).toString("base64").slice(0, 24)}`;

      items.push(
        normalize({
          source: INAH_SOURCE_KEY,
          sourceUrl: row.href,
          externalId,
          title: row.title,
          description: row.description || null,
          dependencyName: "Instituto Nacional de Antropología e Historia (INAH)",
          status: "activa",
          publicationDate: row.dateText || null,
          rawJson: {
            title: row.title,
            href: row.href,
            description: row.description,
            dateText: row.dateText,
            scrapedAt: startedAt,
          },
        }),
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, url: INAH_BASE_URL }, "Error scrapeando INAH fondos");
    errors.push(`INAH scrape error: ${msg}`);
  }

  return { items, errors, startedAt, finishedAt: nowISO() };
}
