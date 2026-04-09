/**
 * COMPRASMX NAVIGATOR — Lógica estructurada para iterar el portal sin casarse con
 * la arquitectura subyacente. Devuelve ListingRow con metadata superficial suficiente
 * para la decisión incremental sin entrar a páginas de detalle.
 *
 * NIVEL 1: scanListing() → ListingRow[] (metadata superficial + fingerprint calculable)
 * NIVEL 2+3: extractDetail() → RawProcurementInput (solo si hay detail fetch)
 */
import { createHash } from "crypto";
import { Page, BrowserContext } from "playwright";
import { createModuleLogger } from "../../core/logger";
import { RawProcurementInput } from "../../normalizers/procurement.normalizer";

const log = createModuleLogger("comprasmx-navigator");

/**
 * Fila superficial de listado.
 * Todos los campos son los que existen SIN navegar al detalle individual.
 * Se usan para calcular el lightweight_fingerprint y tomar la decisión incremental.
 */
export interface ListingRow {
  /** URL directa al expedicente (detail URL). */
  sourceUrl: string;
  /** ID externo tal como aparece en la URL o en el texto de la fila. */
  externalId: string;
  /** Título del expediente extraído del listado (puede ser parcial). */
  title: string | null;
  /** Dependencia / convocante visible en la fila del listado. */
  dependency: string | null;
  /** Estatus visible en el listado (e.g. Publicado, Vigente, Adjudicado). */
  status: string | null;
  /** Fecha visible en la fila (publicación, apertura o la primera que aparezca). */
  visibleDate: string | null;
  /** Texto completo de la fila normalizado — usado como base del fingerprint. */
  rowText: string;
}

/**
 * Construye el lightweight_fingerprint a partir de los campos superficiales de la fila.
 * Es determinista, estable, barato y normaliza espacios/capitalización para ser inmune al ruido menor.
 */
export function buildListingFingerprint(row: ListingRow): string {
  // Normalización: minúsculas, colapsar espacios múltiples, trim
  const normalize = (v: string | null | undefined): string =>
    (v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

  // Los campos que participan en el fingerprint son los más estables del listado
  const parts = [
    normalize(row.externalId),
    normalize(row.title),
    normalize(row.dependency),
    normalize(row.status),
    normalize(row.visibleDate),
  ];

  return createHash("sha256").update(parts.join("|")).digest("hex");
}

// ─── Selectores — se abstraen para actualizar sin tocar lógica ────────────────
// IMPORTANTE: estos selectores son representativos. Deben ajustarse al DOM real
// del portal comprasmx.buengobierno.gob.mx tras inspeccionarlo.
export const SELECTORS = {
  SEARCH_INPUT: 'input[name="search"], input#search, .search-box input',
  SEARCH_BUTTON: 'button[type="submit"], .btn-search',
  LISTING_ROWS: "table tbody tr, .listing-row, .card-item, .resultado-item",
  PAGINATION_NEXT:
    'a.next-page, button.next, .pagination-next, a[aria-label="Siguiente"], a[aria-label="next"]',
  DETAIL_LINK:
    'a.detail-link, a[href*="expediente"], a[href*="detalle"], a[href*="concurso"]',
  // Sub-selectores dentro de la fila del listado (TD de tabla o atributos de card)
  ROW_TITLE: '.titulo, .title, td:nth-child(2), [class*="title"]',
  ROW_DEPENDENCY:
    '.dependencia, .dependency, td:nth-child(3), [class*="depend"]',
  ROW_STATUS:
    '.estatus, .status, td:nth-child(4), [class*="status"], [class*="estatus"]',
  ROW_DATE: '.fecha, .date, td:nth-child(5), [class*="fecha"], [class*="date"]',
  // Campos del detalle (navegación de nivel 2)
  FIELD_TITLE: "h1, .expediente-title, .title-field",
  FIELD_DEPENDENCY: '.dependencia, td:has-text("Dependencia") + td',
  FIELD_BUYING_UNIT:
    '.unidad-compradora, td:has-text("Unidad Compradora") + td',
  FIELD_PROCEDURE_TYPE: '.tipo-procedimiento, td:has-text("Tipo") + td',
  FIELD_STATUS: '.estatus, td:has-text("Estatus") + td',
  FIELD_LICITATION_NUM:
    '.numero-licitacion, td:has-text("Número Licitación") + td',
  FIELD_PUB_DATE: '.fecha-publicacion, td:has-text("Publicación") + td',
  FIELD_OPENING_DATE: '.fecha-apertura, td:has-text("Apertura") + td',
  FIELD_AMOUNT: '.monto, td:has-text("Monto") + td',
  ATTR_ATTACHMENT_LINK: 'a[href$=".pdf"], a[href$=".zip"], .attachment-link',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function safeText(page: Page, selector: string): Promise<string | null> {
  try {
    const el = await page.$(selector);
    if (!el) return null;
    const txt = await el.textContent();
    return txt ? txt.trim() : null;
  } catch {
    return null;
  }
}

/** Extrae el ID externo de una URL de detalle. */
function extractExternalId(url: string): string {
  const regexExpediente = /(?:id=|expediente=|exp=|concurso[=/])(\w[\w\-]+)/i;
  const urlMatch = url.match(regexExpediente);
  return urlMatch
    ? urlMatch[1]
    : Buffer.from(url).toString("base64").substring(0, 50);
}

// ─── Navigator ────────────────────────────────────────────────────────────────

export class ComprasMxNavigator {
  /**
   * NIVEL 1 — LISTING SCAN (Superficial)
   *
   * Navega al listado general y extrae ListingRow[] con metadata superficial suficiente
   * para tomar la decisión incremental sin entrar al detalle de cada expediente.
   *
   * El caller puede calcular el lightweight_fingerprint con buildListingFingerprint().
   */
  async scanListing(
    page: Page,
    baseUrl: string,
    maxPages: number,
  ): Promise<{ rows: ListingRow[]; pagesScanned: number }> {
    log.info({ baseUrl, maxPages }, "📋 incremental scan started");
    const seen = new Map<string, ListingRow>();
    let pagesScanned = 0;

    try {
      await page.goto(baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    } catch (err) {
      log.error({ err, baseUrl }, "❌ Error cargando URL seeds de Compras MX");
      return { rows: [], pagesScanned: 0 };
    }

    while (pagesScanned < maxPages) {
      pagesScanned++;
      log.info(
        { page: pagesScanned, maxPages },
        `📄 listing page scanned ${pagesScanned}`,
      );

      // Esperar filas — si no aparecen, terminamos
      try {
        await page.waitForSelector(SELECTORS.LISTING_ROWS, { timeout: 10000 });
      } catch {
        log.warn(
          { page: pagesScanned },
          "No se encontraron filas en esta página — fin de listado",
        );
        break;
      }

      // Extracción superficial en contexto del browser (evalúa en el DOM)
      const rawRows = await page.$$eval(
        SELECTORS.LISTING_ROWS,
        (elements, sel) => {
          return elements
            .map((el) => {
              // Debe haber un link de detalle
              const a = el.querySelector(sel.DETAIL_LINK) as any;
              if (!a || !a.href) return null;

              const getText = (s: string) => {
                const node = el.querySelector(s) as any;
                return node
                  ? (node.textContent ?? "").replace(/\s+/g, " ").trim()
                  : null;
              };

              return {
                sourceUrl: a.href,
                title: getText(sel.ROW_TITLE),
                dependency: getText(sel.ROW_DEPENDENCY),
                status: getText(sel.ROW_STATUS),
                visibleDate: getText(sel.ROW_DATE),
                rowText: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
              };
            })
            .filter((r): r is NonNullable<typeof r> => r !== null);
        },
        SELECTORS,
      );

      let newOnPage = 0;
      for (const r of rawRows) {
        if (!seen.has(r.sourceUrl)) {
          const externalId = extractExternalId(r.sourceUrl);
          seen.set(r.sourceUrl, {
            sourceUrl: r.sourceUrl,
            externalId,
            title: r.title,
            dependency: r.dependency,
            status: r.status,
            visibleDate: r.visibleDate,
            rowText: r.rowText,
          });
          newOnPage++;
        }
      }

      log.info(
        { newOnPage, totalSoFar: seen.size, page: pagesScanned },
        "📊 Rows extraídos en esta página",
      );

      if (pagesScanned >= maxPages) {
        log.info(
          { maxPages },
          "Límite de páginas alcanzado. Deteniendo listing scan.",
        );
        break;
      }

      // Navegar a la siguiente página
      const nextBtn = await page.$(SELECTORS.PAGINATION_NEXT);
      if (!nextBtn) {
        log.info("No hay botón de siguiente página. Fin de listado.");
        break;
      }

      const isDisabled = await nextBtn.evaluate(
        (el) =>
          el.hasAttribute("disabled") || el.classList.contains("disabled"),
      );
      if (isDisabled) {
        log.info("Botón de siguiente deshabilitado. Fin de listado.");
        break;
      }

      try {
        await Promise.all([
          page.waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: 15000,
          }),
          nextBtn.click(),
        ]);
        await page.waitForTimeout(2000); // Pausa defensiva anti-rate-limit
      } catch (err) {
        log.warn(
          { err, page: pagesScanned },
          "Error navegando a siguiente página",
        );
        break;
      }
    }

    const finalRows = Array.from(seen.values());
    log.info(
      { total: finalRows.length, pagesScanned },
      "✅ Listing scan completado",
    );
    return { rows: finalRows, pagesScanned };
  }

  /**
   * NIVEL 2 y 3 — DETAIL FETCH & ATTACHMENTS
   *
   * Solo se llama cuando el expediente es nuevo o el lightweight_fingerprint cambió.
   * Retorna metadata completa incluyendo adjuntos.
   */
  async extractDetail(
    context: BrowserContext,
    detailUrl: string,
  ): Promise<RawProcurementInput | null> {
    const page = await context.newPage();

    try {
      log.info({ url: detailUrl }, "📥 detail fetch triggered new record");
      await page.goto(detailUrl, {
        waitUntil: "domcontentloaded",
        timeout: 25000,
      });

      const externalId = extractExternalId(detailUrl);

      const title =
        (await safeText(page, SELECTORS.FIELD_TITLE)) ?? "Sin Título";
      const dependencyName = await safeText(page, SELECTORS.FIELD_DEPENDENCY);
      const buyingUnit = await safeText(page, SELECTORS.FIELD_BUYING_UNIT);
      const procedureType = await safeText(
        page,
        SELECTORS.FIELD_PROCEDURE_TYPE,
      );
      const status = await safeText(page, SELECTORS.FIELD_STATUS);
      const licitationNumber = await safeText(
        page,
        SELECTORS.FIELD_LICITATION_NUM,
      );
      const publicationDate = await safeText(page, SELECTORS.FIELD_PUB_DATE);
      const openingDate = await safeText(page, SELECTORS.FIELD_OPENING_DATE);
      const amountRaw = await safeText(page, SELECTORS.FIELD_AMOUNT);

      // Adjuntos — Nivel 3
      const attachmentsElements = await page.$$(SELECTORS.ATTR_ATTACHMENT_LINK);
      const attachmentsInfo: Array<{
        fileName: string;
        fileUrl: string;
        fileType: string;
      }> = [];

      for (const el of attachmentsElements) {
        const href = await el.getAttribute("href");
        const text = await el.textContent();
        if (href) {
          const absoluteUrl = new URL(href, detailUrl).toString();
          attachmentsInfo.push({
            fileName: text ? text.trim() : "Documento_Adjunto",
            fileUrl: absoluteUrl,
            fileType: absoluteUrl.toLowerCase().endsWith(".pdf")
              ? "application/pdf"
              : "unknown",
          });
        }
      }

      await page.close();

      // Extraer expediente_id de la URL si es posible
      const regexExpediente =
        /(?:id=|expediente=|exp=|concurso[=/])(\w[\w\-]+)/i;
      const urlExpMatch = detailUrl.match(regexExpediente);
      const expedienteId = urlExpMatch ? urlExpMatch[1] : null;

      return {
        source: "comprasmx",
        sourceUrl: detailUrl,
        externalId,
        expedienteId,
        licitationNumber,
        title,
        dependencyName,
        buyingUnit,
        procedureType,
        status,
        publicationDate,
        openingDate,
        amount: amountRaw,
        attachments: attachmentsInfo,
        rawJson: { url: detailUrl, extractions: "playwright_v2_incremental" },
      };
    } catch (err) {
      log.error(
        { err, detailUrl },
        "❌ Falla al extraer detalle de expediente (skipped)",
      );
      await page.close().catch(() => {});
      return null;
    }
  }
}
