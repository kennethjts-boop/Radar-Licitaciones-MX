/**
 * DOF SIDOF — Scraping legal del buscador público del Diario Oficial de la Federación.
 * Usa axios + cheerio (sin Playwright). Falla silenciosamente.
 */
import axios from "axios";
import * as cheerio from "cheerio";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { filterProcurementScope } from "../../services/procurement-scope-filter";

const log = createModuleLogger("dof-sidof");

const SIDOF_URL = "https://sidof.segob.gob.mx/notas/buscar";
const TIMEOUT_MS = 10_000;
const RATE_LIMIT_MS = 3_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface DofQuery {
  keywords: string[];
  scope: "MORELOS_ONLY" | "NATIONAL_CAPUFE_DESIERTA";
  maxResults?: number;
}

export interface DofPublication {
  title: string | null;
  dependency: string | null;
  publicationDate: string | null;
  dofUrl: string | null;
  procedureNumber: string | null;
  retrievedAt: string;
}

export interface DofResult {
  source: "dof-sidof";
  publications: DofPublication[];
  status: "ok" | "partial" | "error" | "unavailable";
  errors: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractProcedureNumber(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/(?:LPN|LPI|AD|INV|ITP)[-\s]?\d[\d\-\/A-Z]*/i);
  return match ? match[0].trim() : null;
}

function parsePublications(html: string, baseUrl: string, maxResults: number): DofPublication[] {
  const $ = cheerio.load(html);
  const results: DofPublication[] = [];
  const now = nowISO();

  // Intentar múltiples selectores para adaptarse a cambios en el HTML
  const itemSelectors = [
    ".nota-item",
    "article",
    ".result-item",
    "li.search-result",
    "tr.result",
  ];

  let $items: ReturnType<typeof $> | null = null;
  for (const sel of itemSelectors) {
    const found = $(sel);
    if (found.length > 0) {
      $items = found;
      break;
    }
  }

  if (!$items || $items.length === 0) return [];

  $items.each((_, el) => {
    if (results.length >= maxResults) return false as unknown as void;

    const $el = $(el);

    const titleEl = $el.find("h3, h2, .nota-titulo, .titulo, a").first();
    const title = titleEl.text().trim() || null;

    const href = titleEl.find("a").attr("href") ?? titleEl.attr("href") ?? null;
    const dofUrl = href
      ? href.startsWith("http")
        ? href
        : `${new URL(baseUrl).origin}${href}`
      : null;

    const dependency =
      $el.find(".nota-dependencia, .dependencia, .organismo").first().text().trim() || null;

    const dateText =
      $el.find(".nota-fecha, .fecha, time").first().text().trim() || null;

    results.push({
      title,
      dependency,
      publicationDate: dateText,
      dofUrl,
      procedureNumber: extractProcedureNumber(title),
      retrievedAt: now,
    });
  });

  return results;
}

// ── Función principal ──────────────────────────────────────────────────────────

export async function fetchDofSidof(query: DofQuery): Promise<DofResult> {
  const maxResults = query.maxResults ?? 20;
  const searchQuery = query.keywords.join(" ");

  const base: DofResult = {
    source: "dof-sidof",
    publications: [],
    status: "unavailable",
    errors: [],
  };

  try {
    log.info({ keywords: query.keywords, scope: query.scope }, "🔍 fetchDofSidof iniciado");

    const response = await axios.get(SIDOF_URL, {
      timeout: TIMEOUT_MS,
      params: { busqueda: searchQuery },
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (process.env.NODE_ENV !== "test") {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }

    const html: string = typeof response.data === "string" ? response.data : "";
    const raw = parsePublications(html, SIDOF_URL, maxResults);

    // Filtrar por scope usando título y dependencia como canonical_text
    const filtered = raw.filter((pub) => {
      const scopeResult = filterProcurementScope({
        dependency: pub.dependency,
        canonical_text: `${pub.title ?? ""} ${pub.dependency ?? ""}`,
      });
      return scopeResult.allowed;
    });

    log.info(
      { raw: raw.length, filtered: filtered.length },
      "✅ fetchDofSidof completado",
    );

    return { ...base, publications: filtered, status: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, "⚠️ DOF SIDOF no disponible");
    return { ...base, status: "unavailable", errors: [msg] };
  }
}
