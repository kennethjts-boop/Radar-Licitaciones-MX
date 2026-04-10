import { getConfig } from "../config/env";
import { createModuleLogger } from "../core/logger";
import { BrowserManager } from "../collectors/comprasmx/browser.manager";
import { ComprasMxNavigator } from "../collectors/comprasmx/comprasmx.navigator";
import type { AgentSearchResult } from "./agent.service";

const log = createModuleLogger("agent-search-handler");

const MAX_RESULTS = 5;
const CAPUFE_LATEST_LINK = "https://comprasmx.hacienda.gob.mx/";
const RESULT_TABLE_SELECTOR = ".p-datatable, .table, .p-datatable-tbody tr, .table tbody tr";

export interface ActiveSearchInput {
  searchId: string;
  query: string;
}

function dedupeByExpediente(
  results: AgentSearchResult[],
): AgentSearchResult[] {
  const seen = new Set<string>();
  const deduped: AgentSearchResult[] = [];

  for (const row of results) {
    const key = row.expedienteId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
    if (deduped.length >= MAX_RESULTS) break;
  }

  return deduped;
}


async function waitForDynamicResults(page: any): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForSelector(RESULT_TABLE_SELECTOR, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(2_500);
}

async function triggerLazyLoadWithScroll(page: any): Promise<void> {
  await page.evaluate(() => {
    // @ts-ignore
    window.scrollTo(0, 320);
  }).catch(() => {});
  await page.waitForTimeout(1_500);
}

async function closeBlockingPopups(page: any): Promise<void> {
  await page.evaluate(() => {
    const clickByText = (needle: string) => {
      // @ts-ignore
      const nodes = Array.from(document.querySelectorAll("button, a, span, div")) as any[];
      const node = nodes.find((el) =>
        String(el.textContent ?? "")
          .toLowerCase()
          .includes(needle),
      );
      // @ts-ignore
      node?.click?.();
    };

    // @ts-ignore
    const dialogs = Array.from(document.querySelectorAll(".modal, .dialog, [role='dialog']")) as any[];
    dialogs.forEach((dialog) => {
      const closeBtn =
        dialog.querySelector("button.close, .close, [aria-label='Cerrar']") ??
        null;
      // @ts-ignore
      closeBtn?.click?.();
    });

    clickByText("cerrar");
    clickByText("aceptar");
    clickByText("continuar");
  }).catch(() => {});
}

async function ensureResultsTableReady(page: any): Promise<boolean> {
  await triggerLazyLoadWithScroll(page);

  const readyNow = await page
    .waitForSelector(RESULT_TABLE_SELECTOR, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  if (readyNow) return true;

  // Reintento único con reload antes de rendirse.
  await page.reload({ waitUntil: "networkidle", timeout: 45_000 }).catch(() => {});
  await triggerLazyLoadWithScroll(page);

  const readyAfterReload = await page
    .waitForSelector(RESULT_TABLE_SELECTOR, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  return readyAfterReload;
}
async function applyKeywordFilterInComprasMx(
  page: any,
  query: string,
): Promise<void> {
  await page.waitForTimeout(2_500);

  const filterApplied = await page.evaluate((keyword: string) => {
    // @ts-ignore
    const candidates = Array.from(
      // @ts-ignore
      document.querySelectorAll('input[type="text"], input.p-inputtext'),
    ) as any[];

    const target = candidates.find((input) => {
      const placeholder = (input.placeholder || "").toLowerCase();
      const aria = (input.getAttribute("aria-label") || "").toLowerCase();
      const cls = (input.className || "").toLowerCase();
      return (
        placeholder.includes("buscar") ||
        aria.includes("buscar") ||
        cls.includes("filter") ||
        cls.includes("search")
      );
    });

    if (!target) return false;

    target.focus();
    target.value = keyword;
    // @ts-ignore
    target.dispatchEvent(new Event("input", { bubbles: true }));
    // @ts-ignore
    target.dispatchEvent(new Event("change", { bubbles: true }));
    target.dispatchEvent(
      // @ts-ignore
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    return true;
  }, query);

  log.info({ query, filterApplied }, "ComprasMX keyword filter execution");
  await page.waitForTimeout(3_500);
}

async function activateWideSearchMode(page: any): Promise<void> {
  const modeApplied = await page.evaluate(() => {
    const lower = (txt: string | null | undefined) => (txt ?? "").toLowerCase();

    const clickByText = (needle: string): boolean => {
      // @ts-ignore
      const elements = Array.from(
        // @ts-ignore
        document.querySelectorAll('button, label, span, a, li, div, p-checkbox, p-radiobutton'),
      ) as any[];
      const found = elements.find((el) => lower(el.textContent).includes(needle));
      if (!found) return false;
      // @ts-ignore
      found.click?.();
      const input = found.querySelector?.('input[type="checkbox"], input[type="radio"]');
      // @ts-ignore
      input?.click?.();
      return true;
    };

    const allYears = clickByText("todos los años") || clickByText("todos los años");
    const vigentes = clickByText("anuncios vigentes") || clickByText("vigentes");
    const planeacion = clickByText("planeación") || clickByText("planeacion");

    return {
      allYears,
      vigentes,
      planeacion,
    };
  });

  log.info({ modeApplied }, "ComprasMX multi-extraction mode toggled");
  await page.waitForTimeout(4_000);
}

function rowsToAgentResults(
  rows: Array<{
    externalId: string;
    title: string | null;
    dependency: string | null;
    status: string | null;
    sourceUrl: string;
  }>,
  prefix: string,
  fallbackUrl: string,
): AgentSearchResult[] {
  return rows.map((row, index) => ({
    id: `${prefix}-${index}`,
    expedienteId: row.externalId || `SIN-ID-${index + 1}`,
    licitacionNombre: row.title ?? "Sin título",
    dependencia: row.dependency ?? "Sin dependencia",
    sourceUrl: row.sourceUrl || fallbackUrl,
    summary: row.status ?? "Sin estatus",
  }));
}

async function extractPortalResults(
  page: any,
  navigator: ComprasMxNavigator,
  baseUrl: string,
  query: string,
  mode: "default" | "multi",
): Promise<AgentSearchResult[]> {
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 45_000 });
  await closeBlockingPopups(page);

  await applyKeywordFilterInComprasMx(page, query);
  if (mode === "multi") {
    await activateWideSearchMode(page);
  }

  const tableReady = await ensureResultsTableReady(page);
  await waitForDynamicResults(page);

  log.info({ mode, query, tableReady }, "Result table readiness check");

  let { rows, pagesScanned } = await navigator.scanListing(
    page,
    baseUrl,
    mode === "multi" ? 3 : 1,
  );

  if (rows.length === 0) {
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(6_000);
    const retryScan = await navigator.scanListing(
      page,
      baseUrl,
      mode === "multi" ? 2 : 1,
    );
    rows = retryScan.rows;
    pagesScanned = Math.max(pagesScanned, retryScan.pagesScanned);
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    const haystack = [row.externalId, row.title, row.dependency]
      .map((v) => (v ?? "").toLowerCase())
      .join(" ");
    return haystack.includes(normalizedQuery);
  });

  const usable = (filtered.length > 0 ? filtered : rows).slice(0, MAX_RESULTS);

  log.info(
    {
      mode,
      query,
      scannedRows: rows.length,
      filteredRows: filtered.length,
      pagesScanned,
      returned: usable.length,
    },
    "ComprasMX extraction route completed",
  );

  return rowsToAgentResults(usable, `mx-${mode}`, page.url());
}

async function extractGoogleFallbackResults(
  page: any,
  query: string,
): Promise<AgentSearchResult[]> {
  const searchQuery = `${query} CAPUFE expediente licitación site:comprasmx.buengobierno.gob.mx`;
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;

  await page.goto(googleUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  await page.waitForTimeout(4_000);

  const fallbackRows = await page.evaluate(() => {
    const extractExpediente = (text: string): string | null => {
      const regexes = [
        /[A-Z]{2,8}-[A-Z0-9-]{6,}/g,
        /\b[A-Z0-9]{10,}\b/g,
      ];

      for (const re of regexes) {
        const match = text.match(re);
        if (match && match[0]) return match[0];
      }

      return null;
    };

    // @ts-ignore
    const links = Array.from(document.querySelectorAll("a h3")).slice(0, 8) as any[];

    return links.map((titleNode, idx) => {
      const anchor = titleNode.closest("a") as any;
      const block = titleNode.parentElement?.parentElement;
      const snippet = (block?.textContent || "").replace(/\s+/g, " ").trim();
      const title = (titleNode.textContent || "Resultado sin título").trim();
      const expedienteId = extractExpediente(`${title} ${snippet}`) || `OSINT-${idx + 1}`;

      return {
        externalId: expedienteId,
        title,
        dependency: "Fuente externa (Google/OSINT)",
        status: "Verificar en ComprasMX",
        sourceUrl: anchor?.href || "",
      };
    });
  });

  const results = rowsToAgentResults(
    fallbackRows.slice(0, MAX_RESULTS),
    "osint-google",
    googleUrl,
  );

  log.info(
    { query, extracted: fallbackRows.length, returned: results.length },
    "Google fallback route completed",
  );

  return results;
}

/**
 * Fase 1.1: búsqueda multi-extracción.
 * Ruta 1: ComprasMX default.
 * Ruta 2: ComprasMX ampliada (todos los años + vigentes + planeación).
 * Ruta 3: fallback OSINT con Google.
 */
export async function runActiveSearch(
  input: ActiveSearchInput,
): Promise<AgentSearchResult[]> {
  const config = getConfig();
  const navigator = new ComprasMxNavigator();

  return BrowserManager.withContext(async (page) => {
    await page
      .setExtraHTTPHeaders({
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      })
      .catch(() => {});

    const route1 = await extractPortalResults(
      page,
      navigator,
      config.COMPRASMX_SEED_URL,
      input.query,
      "default",
    );

    if (route1.length > 0) {
      return dedupeByExpediente(route1);
    }

    const route2 = await extractPortalResults(
      page,
      navigator,
      config.COMPRASMX_SEED_URL,
      input.query,
      "multi",
    );

    if (route2.length > 0) {
      return dedupeByExpediente(route2);
    }

    const route3 = await extractGoogleFallbackResults(page, input.query);

    if (route3.length > 0) {
      return dedupeByExpediente(route3);
    }

    log.warn(
      {
        searchId: input.searchId,
        query: input.query,
        capufeLatestLink: CAPUFE_LATEST_LINK,
      },
      "All search routes returned empty",
    );

    return [];
  }, { timeoutMs: 60_000 });
}

export async function captureComprasMxDebugScreenshot(
  query: string,
): Promise<Buffer | null> {
  const config = getConfig();

  try {
    return await BrowserManager.withContext(async (page) => {
      await page.goto(config.COMPRASMX_SEED_URL, {
        waitUntil: "networkidle",
        timeout: 45_000,
      });
      await closeBlockingPopups(page);

      await page.setExtraHTTPHeaders({
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      }).catch(() => {});

      await applyKeywordFilterInComprasMx(page, query);
      await ensureResultsTableReady(page);
      await waitForDynamicResults(page);

      return await page.screenshot({ fullPage: true, type: "png" });
    });
  } catch (err) {
    log.warn({ err, query }, "Could not capture ComprasMX debug screenshot");
    return null;
  }
}

export const AGENT_MANUAL_CAPUFE_LINK = CAPUFE_LATEST_LINK;
