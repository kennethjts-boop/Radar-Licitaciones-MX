import { getConfig } from "../config/env";
import { createModuleLogger } from "../core/logger";
import { BrowserManager } from "../collectors/comprasmx/browser.manager";
import { ComprasMxNavigator } from "../collectors/comprasmx/comprasmx.navigator";
import type { AgentSearchResult } from "./agent.service";

const log = createModuleLogger("agent-search-handler");

export interface ActiveSearchInput {
  searchId: string;
  query: string;
}

async function applyKeywordFilterInComprasMx(
  page: any,
  query: string,
): Promise<void> {
  await page.waitForTimeout(1500);

  const filterApplied = await page.evaluate((keyword: string) => {
    const lowered = keyword.toLowerCase();
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

    // algunos componentes PrimeNG filtran después de Enter.
    target.dispatchEvent(
      // @ts-ignore
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    // fallback mínimo para triggers reactivos
    target.setAttribute("data-agent-keyword", lowered);
    return true;
  }, query);

  log.info({ query, filterApplied }, "ComprasMX keyword filter execution");
  await page.waitForTimeout(1500);
}

/**
 * Fase 1: búsqueda real en ComprasMX con navegación Playwright reutilizando
 * la infraestructura endurecida de BrowserManager + ComprasMxNavigator.
 */
export async function runActiveSearch(
  input: ActiveSearchInput,
): Promise<AgentSearchResult[]> {
  const config = getConfig();
  const navigator = new ComprasMxNavigator();
  const normalizedQuery = input.query.trim().toLowerCase();

  return BrowserManager.withContext(async (page) => {
    await page.goto(config.COMPRASMX_SEED_URL, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });

    await applyKeywordFilterInComprasMx(page, input.query);

    const { rows } = await navigator.scanListing(page, config.COMPRASMX_SEED_URL, 1);

    const filtered = rows.filter((row) => {
      const haystack = [row.externalId, row.title, row.dependency]
        .map((v) => (v ?? "").toLowerCase())
        .join(" ");
      return haystack.includes(normalizedQuery);
    });

    const selectedRows = (filtered.length > 0 ? filtered : rows).slice(0, 5);

    const results = selectedRows.map((row, index) => ({
      id: `opt-${index}`,
      expedienteId: row.externalId,
      licitacionNombre: row.title ?? "Sin título",
      dependencia: row.dependency ?? "Sin dependencia",
      sourceUrl: row.sourceUrl || page.url(),
      summary: row.status ?? "Sin estatus",
    }));

    log.info(
      {
        searchId: input.searchId,
        query: input.query,
        extractedRows: rows.length,
        returned: results.length,
      },
      "Active search real extraction finished",
    );

    return results;
  });
}
