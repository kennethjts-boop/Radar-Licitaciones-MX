/**
 * GESTIONANDOTE COLLECTOR — GestionandoTe.org
 * URL: https://www.gestionandote.org/category/subvenciones/
 *
 * WordPress — scraper estático con axios + cheerio.
 */
import axios from "axios";
import * as cheerio from "cheerio";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { normalize } from "../../normalizers/procurement.normalizer";
import type { NormalizedProcurement } from "../../types/procurement";

const log = createModuleLogger("collector-fondos-gestionandote");

export const GESTIONANDOTE_SOURCE_KEY = "fondos_gestionandote";
export const GESTIONANDOTE_BASE_URL =
  "https://www.gestionandote.org/category/subvenciones/";

export interface GestionandoteCollectResult {
  items: NormalizedProcurement[];
  errors: string[];
  startedAt: string;
  finishedAt: string;
}

export async function collectGestionandote(): Promise<GestionandoteCollectResult> {
  const startedAt = nowISO();
  const errors: string[] = [];
  const items: NormalizedProcurement[] = [];

  try {
    log.info(
      { url: GESTIONANDOTE_BASE_URL },
      "Iniciando scrape GestionandoTe fondos",
    );

    const response = await axios.get<string>(GESTIONANDOTE_BASE_URL, {
      timeout: 15_000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; RadarLicitacionesMX/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      responseType: "text",
    });

    const $ = cheerio.load(response.data);

    const posts: Array<{
      title: string;
      href: string;
      excerpt: string;
      dateText: string;
    }> = [];

    // WordPress standard selectors
    const selectors = [
      "article",
      ".post",
      ".entry",
      ".blog-post",
      ".type-post",
      ".hentry",
      ".loop-entry",
    ];

    for (const sel of selectors) {
      $(sel).each((_, el) => {
        const titleEl = $(el)
          .find(
            "h1.entry-title a, h2.entry-title a, h3.entry-title a, .entry-title a, .post-title a, h2 a, h3 a",
          )
          .first();
        const title =
          titleEl.text().trim() ||
          $(el).find("h1, h2, h3").first().text().trim();

        if (!title || title.length < 5) return;

        const href =
          titleEl.attr("href") ||
          $(el).find("a").first().attr("href") ||
          GESTIONANDOTE_BASE_URL;

        const excerpt = $(el)
          .find(".entry-summary p, .entry-content p, .excerpt p, p")
          .first()
          .text()
          .trim();

        const dateText =
          $(el)
            .find(
              "time.entry-date, .entry-date, .published, .post-date, time[datetime]",
            )
            .first()
            .text()
            .trim() ||
          $(el).find("time").first().attr("datetime") ||
          "";

        posts.push({ title, href, excerpt, dateText });
      });

      if (posts.length > 0) break;
    }

    // Fallback: h2/h3 links
    if (posts.length === 0) {
      $("h2 a, h3 a").each((_, el) => {
        const title = $(el).text().trim();
        if (!title || title.length < 5) return;
        const href = $(el).attr("href") || GESTIONANDOTE_BASE_URL;
        posts.push({ title, href, excerpt: "", dateText: "" });
      });
    }

    log.info({ count: posts.length }, "Posts GestionandoTe encontrados");

    for (const post of posts) {
      const externalId = `gestionandote_${Buffer.from(post.href).toString("base64").slice(0, 24)}`;

      items.push(
        normalize({
          source: GESTIONANDOTE_SOURCE_KEY,
          sourceUrl: post.href,
          externalId,
          title: post.title,
          description: post.excerpt || null,
          dependencyName: "GestionandoTe — Subvenciones y Convocatorias OSC",
          status: "activa",
          publicationDate: post.dateText || null,
          rawJson: {
            title: post.title,
            href: post.href,
            excerpt: post.excerpt,
            dateText: post.dateText,
            scrapedAt: startedAt,
          },
        }),
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(
      { err, url: GESTIONANDOTE_BASE_URL },
      "Error scrapeando GestionandoTe fondos",
    );
    errors.push(`GestionandoTe scrape error: ${msg}`);
  }

  return { items, errors, startedAt, finishedAt: nowISO() };
}
