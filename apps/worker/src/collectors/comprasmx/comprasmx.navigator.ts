/**
 * COMPRASMX NAVIGATOR — Lógica estructurada para iterar el portal sin casarse con
 * la arquitectura subyacente. Usar selectores configurables y manejo defensivo de errores.
 */
import { Page, BrowserContext } from 'playwright';
import { createModuleLogger } from '../../core/logger';
import { RawProcurementInput } from '../../normalizers/procurement.normalizer';

const log = createModuleLogger('comprasmx-navigator');

export interface ListingRow {
  sourceUrl: string;
  externalId: string;
  rowText: string;
}

// Selectores genéricos abstraídos para que puedan actualizarse si la UI cambia
export const SELECTORS = {
  SEARCH_INPUT: 'input[name="search"], input#search, .search-box input',
  SEARCH_BUTTON: 'button[type="submit"], .btn-search',
  LISTING_ROWS: 'table tbody tr, .listing-row, .card-item',
  PAGINATION_NEXT: 'a.next-page, button.next, .pagination-next',
  DETAIL_LINK: 'a.detail-link, a[href*="expediente"], a[href*="detalle"]',
  // Campos del detalle
  FIELD_TITLE: 'h1, .expediente-title, .title-field',
  FIELD_DEPENDENCY: '.dependencia, td:has-text("Dependencia") + td',
  FIELD_BUYING_UNIT: '.unidad-compradora, td:has-text("Unidad Compradora") + td',
  FIELD_PROCEDURE_TYPE: '.tipo-procedimiento, td:has-text("Tipo") + td',
  FIELD_STATUS: '.estatus, td:has-text("Estatus") + td',
  FIELD_LICITATION_NUM: '.numero-licitacion, td:has-text("Número Licitación") + td',
  FIELD_PUB_DATE: '.fecha-publicacion, td:has-text("Publicación") + td',
  FIELD_OPENING_DATE: '.fecha-apertura, td:has-text("Apertura") + td',
  FIELD_AMOUNT: '.monto, td:has-text("Monto") + td',
  ATTR_ATTACHMENT_LINK: 'a[href$=".pdf"], a[href$=".zip"], .attachment-link',
};

// Extractor de texto seguro
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

export class ComprasMxNavigator {
  /**
   * NIVEL 1 — LISTING SCAN
   * Navega a la URL semilla, itera la paginación con un límite, y extrae los rows
   * (links + texto de fila para el fingerprint incremental).
   */
  async scanListing(
    page: Page,
    baseUrl: string,
    maxPages: number
  ): Promise<ListingRow[]> {
    log.info({ baseUrl, maxPages }, '🔎 NIVEL 1: Iniciando Listing Scan (Shallow)...');
    const listingRows: Record<string, ListingRow> = {};

    let currentPage = 1;

    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (err) {
      log.error({ err, baseUrl }, '❌ Error cargando URL principal de Compras MX');
      return [];
    }

    while (currentPage <= maxPages) {
      log.info({ currentPage }, '📄 Escaneando página de resultados');
      try {
        await page.waitForSelector(SELECTORS.LISTING_ROWS, { timeout: 10000 });
      } catch {
        log.warn('No se encontraron filas de listado (fin de resultados o portal vacío).');
        break;
      }

      // Extraer datos superficiales (RowText) e hipervínculos
      const rows = await page.$$eval(SELECTORS.LISTING_ROWS, (elements, selectors) => {
        return elements.map(el => {
          const a = el.querySelector(selectors.DETAIL_LINK) as any;
          if (!a || !a.href) return null;
          return {
            sourceUrl: a.href,
            rowText: el.textContent?.replace(/\s+/g, ' ').trim() || ''
          };
        }).filter(Boolean) as { sourceUrl: string, rowText: string }[];
      }, SELECTORS);

      let foundActives = 0;
      for (const r of rows) {
        if (!listingRows[r.sourceUrl]) {
           const regexExpediente = /(?:id=|expediente=|exp=)(\d+)/i;
           const urlMatch = r.sourceUrl.match(regexExpediente);
           const externalId = urlMatch ? urlMatch[1] : Buffer.from(r.sourceUrl).toString('base64').substring(0, 50);

           listingRows[r.sourceUrl] = {
             sourceUrl: r.sourceUrl,
             externalId,
             rowText: r.rowText
           };
           foundActives++;
        }
      }

      log.info({ newFound: foundActives, totalSoFar: Object.keys(listingRows).length }, '📊 Rows extraídos en esta página');

      if (currentPage >= maxPages) {
        log.info('Límite shallow scan alcanzado. Deteniendo.');
        break;
      }

      // Intentar navegar a la siguiente página
      const nextBtn = await page.$(SELECTORS.PAGINATION_NEXT);
      if (!nextBtn) {
        log.info('No hay botón de siguiente página. Fin del listado.');
        break;
      }

      const isDisabled = await nextBtn.evaluate(el => el.hasAttribute('disabled') || el.classList.contains('disabled'));
      if (isDisabled) {
        log.info('Botón de siguiente página está deshabilitado. Fin del listado.');
        break;
      }

      try {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
          nextBtn.click(),
        ]);
        currentPage++;
        // Retraso defensivo para no ser baneados
        await page.waitForTimeout(2000);
      } catch (err) {
        log.warn({ err }, 'Error navegando a la siguiente página');
        break;
      }
    }

    const finalRows = Object.values(listingRows);
    log.info({ total: finalRows.length }, '✅ Nivel 1 (Scan Superficial) completado');
    return finalRows;
  }

  /**
   * NIVEL 2 y 3 — DETAIL FETCH & ATTACHMENTS
   */
  async extractDetail(
    context: BrowserContext,
    detailUrl: string
  ): Promise<RawProcurementInput | null> {
    const page = await context.newPage();
    
    try {
      log.info({ url: detailUrl }, '📥 Extrayendo expediente');
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      
      // Extrae expediente_id dinámicamente de la url si es posible, o de texto
      const regexExpediente = /(?:id=|expediente=|exp=)(\d+)/i;
      const urlMatch = detailUrl.match(regexExpediente);
      let expedienteId = urlMatch ? urlMatch[1] : null;

      const title = await safeText(page, SELECTORS.FIELD_TITLE) ?? 'Sin Título';
      const dependencyName = await safeText(page, SELECTORS.FIELD_DEPENDENCY);
      const buyingUnit = await safeText(page, SELECTORS.FIELD_BUYING_UNIT);
      const procedureType = await safeText(page, SELECTORS.FIELD_PROCEDURE_TYPE);
      const status = await safeText(page, SELECTORS.FIELD_STATUS);
      const licitationNumber = await safeText(page, SELECTORS.FIELD_LICITATION_NUM);
      const publicationDate = await safeText(page, SELECTORS.FIELD_PUB_DATE);
      const openingDate = await safeText(page, SELECTORS.FIELD_OPENING_DATE);
      const amountRaw = await safeText(page, SELECTORS.FIELD_AMOUNT);

      // Metadatos de adjuntos
      const attachmentsElements = await page.$$(SELECTORS.ATTR_ATTACHMENT_LINK);
      const attachmentsInfo: Array<{ fileName: string; fileUrl: string; fileType: string }> = [];

      for (const el of attachmentsElements) {
        const href = await el.getAttribute('href');
        const text = await el.textContent();
        if (href) {
          const absoluteUrl = new URL(href, detailUrl).toString();
          attachmentsInfo.push({
            fileName: text ? text.trim() : 'Documento_Adjunto',
            fileUrl: absoluteUrl,
            fileType: absoluteUrl.endsWith('.pdf') ? 'application/pdf' : 'unknown'
          });
        }
      }

      await page.close();

      return {
        source: 'comprasmx',
        sourceUrl: detailUrl,
        externalId: expedienteId || Buffer.from(detailUrl).toString('base64').substring(0, 50),
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
        rawJson: { url: detailUrl, extractions: 'playwright_v1' } 
      };

    } catch (err) {
      log.error({ err, detailUrl }, '❌ Falla crítica al extraer detalle de expediente (Skipped)');
      await page.close().catch(() => {});
      return null;
    }
  }
}
