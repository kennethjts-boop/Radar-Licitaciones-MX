/**
 * COMPRASMX NAVIGATOR — Lógica real para el portal de Compras MX (Buen Gobierno).
 * Basado en PrimeNG Table y navegación por clicks.
 *
 * NIVEL 1: scanListing() → ListingRow[]
 * NIVEL 2+3: extractDetail() → RawProcurementInput
 */
import { createHash } from "crypto";
import { Page, BrowserContext } from "playwright";
import { createModuleLogger } from "../../core/logger";
import { RawProcurementInput } from "../../normalizers/procurement.normalizer";
import { getConfig } from "../../config/env";

const log = createModuleLogger("comprasmx-navigator");

export interface ListingRow {
  sourceUrl: string;
  externalId: string;
  title: string | null;
  dependency: string | null;
  status: string | null;
  visibleDate: string | null;
  rowText: string;
}

/**
 * Fingerprint superficial robusto.
 */
export function buildListingFingerprint(row: ListingRow): string {
  const normalize = (v: string | null | undefined): string =>
    (v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

  const parts = [
    normalize(row.externalId),
    normalize(row.title),
    normalize(row.dependency),
    normalize(row.status),
    normalize(row.visibleDate),
  ];

  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export const SELECTORS = {
  // Listing selectors (PrimeNG / DataTables)
  // Se añade soporte para .p-datatable-scrollable-body tr por cambios recientes en el portal.
  LISTING_ROW: '.p-datatable-tbody tr, .p-datatable-scrollable-body tr',
  COL_ID: 'td.col-id',
  COL_TITLE: 'td.col-nom',
  COL_DEP: 'td.col-normal:nth-child(5)',
  COL_STATUS: 'td.col-normal:nth-child(6)',
  COL_DATE: 'td.col-normal:nth-child(8)',
  PAGINATION_NEXT: 'button.p-paginator-next',

  // Detail labels
  DETAIL_LABELS: {
    TITLE: 'Nombre del procedimiento de contratación:',
    STATUS: 'Estatus del procedimiento de contratación:',
    DEPENDENCY: 'Dependencia o Entidad:',
    SOURCE_ID: 'Número de procedimiento de contratación:'
  },

  // Attachments table
  ATTACHMENTS_TABLE_HEADER: 'Tipo de documento'
};

export class ComprasMxNavigator {
  /**
   * Escanea el listado.
   * NOTA: Debido a que la URL de detalle no está en el DOM como href,
   * el listado solo extrae metadata. El collector decidirá si clickar.
   */
  async scanListing(
    page: Page,
    baseUrl: string,
    maxPages: number,
  ): Promise<{ rows: ListingRow[]; pagesScanned: number }> {
    log.info({ baseUrl, maxPages }, "📋 Iniciando scan de listado ComprasMX");
    const allRows: ListingRow[] = [];
    let pagesScanned = 0;

    // ── Interceptar respuestas de la API para capturar externalId → detailUrl ──
    const externalIdToDetailUrl = new Map<string, string>();

    const captureDetailUrls = (response: { url(): string; text(): Promise<string>; status(): number }) => {
      const url = response.url();
      const status = response.status();

      // DIAGNÓSTICO: loguear TODAS las respuestas que puedan ser de la API del listado
      const isApiCandidate =
        url.includes('/whitney/') ||
        url.includes('expediente') ||
        url.includes('procedimiento') ||
        url.includes('buengobierno') ||
        url.includes('upcp');

      if (!isApiCandidate) return;

      response.text().then((raw: string) => {
        // Loguear la URL y los primeros 500 chars de la respuesta para diagnóstico
        log.info(
          { url, status, preview: raw.slice(0, 500) },
          "🔎 DIAG API response interceptada"
        );

        let json: unknown;
        try { json = JSON.parse(raw); } catch { return; }

        const j = json as Record<string, unknown>;

        // Estructura real de la API: { success, data: [{ registros: [...], paginacion: {...} }] }
        // Los expedientes están en data[0].registros[]
        const dataArr = j?.data as unknown[] | undefined;
        const registros = (Array.isArray(dataArr) && dataArr.length > 0)
          ? ((dataArr[0] as Record<string, unknown>)?.registros as unknown[] | undefined)
          : undefined;
        const items = Array.isArray(registros) ? registros : [] as unknown[];

        if (items.length === 0) {
          log.info({ url, keys: Object.keys(j ?? {}).slice(0, 10) }, "🔎 DIAG respuesta JSON sin registros reconocidos");
          return;
        }

        let count = 0;
        for (const item of items) {
          const it = item as Record<string, unknown>;
          const extId = String(it.numero_procedimiento ?? '');
          const uuid  = String(it.uuid_procedimiento ?? '');
          if (extId && uuid && extId !== 'undefined' && uuid !== 'undefined') {
            externalIdToDetailUrl.set(extId,
              `https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/${uuid}/procedimiento`
            );
            count++;
          }
        }
        if (count > 0) {
          log.info({ count, total: externalIdToDetailUrl.size }, "🔗 URLs de detalle capturadas desde API");
        }
      }).catch(() => { /* respuesta no legible */ });
    };

    page.on('response', captureDetailUrls);

    try {
      // Siempre navegar — no comparar page.url() porque Angular hash routing
      // puede normalizar la URL de forma diferente a la string literal.
      log.info({ baseUrl }, "🌐 Navegando al portal ComprasMX...");
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

      // Esperar a que Angular renderice el botón "Buscar" — garantiza que la SPA
      // terminó de inicializar antes de intentar cualquier interacción.
      await page.waitForSelector('button:has-text("Buscar")', { timeout: 20000 });
      await page.waitForTimeout(2000); // Margen extra para que la SPA termine de hidratarse

      // Portal SPA: requiere click en "Buscar" para cargar resultados en la tabla
      log.info("🔍 Activando búsqueda en el portal ComprasMX...");
      try {
        await page.click('button:has-text("Buscar")', { timeout: 8000 });
        // Esperar más de 1 fila: antes de buscar existe solo la fila de "sin resultados"
        await page.waitForFunction(
          `document.querySelectorAll(${JSON.stringify(SELECTORS.LISTING_ROW)}).length > 1`,
          { timeout: 15000 }
        );
        log.info("✅ Tabla de procedimientos cargada con resultados");
      } catch (buscarErr) {
        // Fallo fatal — si "Buscar" no responde, el portal no cargó correctamente.
        // Capturar HTML para diagnóstico y abortar (no continuar con tabla vacía).
        const html = await page.content().catch(() => "(no se pudo obtener HTML)");
        log.error(
          { buscarErr, html: html.slice(0, 2000) },
          "❌ FATAL: No se pudo activar Buscar — el portal no cargó correctamente"
        );
        page.off('response', captureDetailUrls);
        return { rows: [], pagesScanned: 0 };
      }
    } catch (err) {
      log.error({ err, baseUrl }, "❌ Error cargando portal ComprasMX");
      page.off('response', captureDetailUrls);
      return { rows: [], pagesScanned: 0 };
    }

    while (pagesScanned < maxPages) {
      pagesScanned++;
      log.info({ page: pagesScanned }, `📄 Escaneando página ${pagesScanned}`);

      try {
        await page.waitForSelector(SELECTORS.LISTING_ROW, { timeout: 10000 });
      } catch {
        log.warn("No se encontraron filas en la página.");
        break;
      }

      const rowElements = await page.$$(SELECTORS.LISTING_ROW);
      log.info({ selector: SELECTORS.LISTING_ROW, count: rowElements.length }, "Resultado del selector de filas");

      const rowsOnPage = await page.$$eval(
        SELECTORS.LISTING_ROW,
        (elements, sel) => {
          return elements.map((el: any) => {
            const idCell = el.querySelector(sel.COL_ID);
            if (!idCell) return null;

            const getText = (s: string) => {
              const node = el.querySelector(s);
              return node ? (node.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
            };

            return {
              externalId: idCell.textContent?.trim() || '',
              title: getText(sel.COL_TITLE),
              dependency: getText(sel.COL_DEP),
              status: getText(sel.COL_STATUS),
              visibleDate: getText(sel.COL_DATE),
              sourceUrl: '',
              rowText: (el.textContent ?? '').replace(/\s+/g, ' ').trim()
            };
          }).filter(r => r !== null && r.externalId) as any[];
        },
        SELECTORS,
      );

      // Deduplicar por externalId (evita filas duplicadas por frozen columns)
      const uniqueOnPage = Array.from(new Map(rowsOnPage.map(r => [r.externalId, r])).values());
      allRows.push(...uniqueOnPage);
      log.info({ count: uniqueOnPage.length, raw: rowsOnPage.length }, "Filas únicas extraídas en página");

      if (pagesScanned >= maxPages) break;

      const nextBtn = await page.$(SELECTORS.PAGINATION_NEXT);
      if (!nextBtn) break;
      const isDisabled = await nextBtn.evaluate(el => (el as any).disabled);
      if (isDisabled) break;

      await nextBtn.click();
      await page.waitForTimeout(3000);
    }

    // Dar tiempo a que los handlers de response pendientes completen (microtasks)
    await page.waitForTimeout(500);
    page.off('response', captureDetailUrls);

    // Poblar sourceUrl de cada fila con la URL de detalle capturada desde la API.
    let urlsResolved = 0;
    for (const row of allRows) {
      const detailUrl = externalIdToDetailUrl.get(row.externalId);
      if (detailUrl) {
        row.sourceUrl = detailUrl;
        urlsResolved++;
      }
    }

    // DIAGNÓSTICO: resumen del interceptor
    const sampleUrls = Array.from(externalIdToDetailUrl.entries()).slice(0, 3).map(([id, url]) => ({ id, url }));
    log.info(
      {
        urlsResolved,
        total: allRows.length,
        apiMapSize: externalIdToDetailUrl.size,
        sampleUrls,
      },
      urlsResolved > 0
        ? `🔗 URLs capturadas del interceptor: ${urlsResolved} de ${allRows.length} total`
        : `⚠️ URLs capturadas del interceptor: 0 de ${allRows.length} total — fallback activado`
    );

    return { rows: allRows, pagesScanned };
  }

  /**
   * Extrae el detalle.
   * Si se provee una URL, navega a ella. Si se provee un externalId, busca y clicka en la página actual.
   */
  async extractDetail(
    context: BrowserContext,
    urlOrId: string,
    existingPage?: Page
  ): Promise<RawProcurementInput | null> {
    let page = existingPage || await context.newPage();
    
    try {
      if (urlOrId.startsWith('http')) {
        await page.goto(urlOrId, { waitUntil: "domcontentloaded", timeout: 30000 });
        // Esperar a que Angular renderice el contenido del detalle
        await page.waitForSelector('label', { timeout: 20000 });
      } else {
        // Fallback: la API interception no capturó la URL de detalle para este expediente.
        // Navegar al listado en una página fresca, activar búsqueda y hacer click en la fila.
        // Solo funciona para expedientes en página 1 del listado.
        log.info({ externalId: urlOrId }, "🔄 Fallback: navegando al listado para buscar expediente...");
        const config = getConfig();

        await page.goto(config.COMPRASMX_SEED_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForSelector('button:has-text("Buscar")', { timeout: 20000 });
        await page.waitForTimeout(2000);
        await page.click('button:has-text("Buscar")', { timeout: 8000 });
        await page.waitForFunction(
          `document.querySelectorAll(${JSON.stringify(SELECTORS.LISTING_ROW)}).length > 1`,
          { timeout: 15000 }
        );

        const row = page.locator(SELECTORS.LISTING_ROW).filter({ hasText: urlOrId }).first();
        if (await row.count() === 0) {
          log.warn({ externalId: urlOrId }, "⚠️ Expediente no encontrado en página 1 del listado (fallback)");
          return null;
        }
        await row.locator(SELECTORS.COL_ID).click();
        await page.waitForSelector('label', { timeout: 15000 });
      }

      const data = await page.evaluate((sel) => {
        const getValByLabel = (labelText: string) => {
          // @ts-ignore
          const elements = Array.from(document.querySelectorAll('label, span, div, .p-column-title'));
          const found = elements.find((el: any) => {
              const txt = (el.textContent ?? '').trim();
              return txt.includes(labelText);
          }) as any;
          if (!found) return '';
          
          // Caso 1: Hermano directo
          let next = found.nextElementSibling;
          if (next && next.textContent?.trim() && next.textContent.trim().length > 2) {
              return next.textContent.trim();
          }
          
          // Caso 2: El valor contiene el label y el dato (ej: "Nombre: Lic-001")
          const fullText = (found.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (fullText.length > labelText.length + 1) {
              return fullText.replace(labelText, '').trim();
          }

          // Caso 3: El valor está en el padre
          const parent = found.parentElement;
          if (parent) {
              const pText = (parent.textContent ?? '').replace(/\s+/g, ' ').trim();
              if (pText.length > labelText.length + 1) {
                  return pText.replace(labelText, '').trim();
              }
          }
          return '';
        };

        const externalId = getValByLabel(sel.DETAIL_LABELS.SOURCE_ID);
        const title = getValByLabel(sel.DETAIL_LABELS.TITLE);
        const status = getValByLabel(sel.DETAIL_LABELS.STATUS);
        const dependency = getValByLabel(sel.DETAIL_LABELS.DEPENDENCY);

        const attachments: any[] = [];
        // @ts-ignore
        const tables = Array.from(document.querySelectorAll('table'));
        const attTable = tables.find((t: any) => {
           const ths = Array.from(t.querySelectorAll('th')).map((h: any) => h.textContent?.trim());
           return ths.includes(sel.ATTACHMENTS_TABLE_HEADER);
        }) as any;

        if (attTable) {
            const rows = Array.from(attTable.querySelectorAll('tbody tr'));
            rows.forEach((r: any) => {
                const tds = Array.from(r.querySelectorAll('td')) as any[];
                if (tds.length >= 5) {
                    const desc = tds[2].textContent?.trim() || 'Documento';
                    const link = tds[4].querySelector('a, button');
                    attachments.push({
                        fileName: desc,
                        fileUrl: (link as any)?.href || '',
                        fileType: 'document'
                    });
                }
            });
        }

        return {
          externalId,
          title,
          status,
          dependencyName: dependency,
          // @ts-ignore
          sourceUrl: window.location.href,
          attachments
        };
      }, SELECTORS);

      return {
        source: 'comprasmx',
        sourceUrl: data.sourceUrl,
        externalId: data.externalId || urlOrId,
        title: data.title || 'Sin Título',
        status: data.status,
        dependencyName: data.dependencyName,
        attachments: data.attachments,
        rawJson: { ...data, extractedAt: new Date().toISOString() }
      };

    } catch (err) {
      log.error({ err, urlOrId }, "Error extrayendo detalle");
      return null;
    } finally {
      if (!existingPage) await page.close();
    }
  }
}
