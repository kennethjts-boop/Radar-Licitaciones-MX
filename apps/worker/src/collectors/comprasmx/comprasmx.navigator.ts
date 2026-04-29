/**
 * COMPRASMX NAVIGATOR — Lógica real para el portal de Compras MX (Buen Gobierno).
 * Basado en PrimeNG Table y navegación por clicks.
 *
 * NIVEL 1: scanListing() → ListingRow[] + Map<externalId, ApiRegistro>
 *   Los datos completos del expediente vienen directamente de la API interceptada.
 *   No se necesita navigación a la página de detalle para el flujo principal.
 *
 * NIVEL 2 (solo adjuntos): extractDetail() — usado únicamente para descargar documentos.
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
 * Registro crudo tal como lo devuelve la API /whitney/sitiopublico/expedientes.
 * Estructura: response.data[0].registros[]
 */
export interface ApiRegistro {
  no?: number;
  id_procedimiento?: number;
  numero_procedimiento: string;
  uuid_procedimiento?: string;
  nombre_procedimiento?: string;
  siglas?: string;
  estatus_alterno?: string;
  tipo_procedimiento?: string;
  cod_expediente?: string;
  fecha_apertura?: string;
  fecha_publicacion?: string;
  fecha_aclaraciones?: string;
  monto?: number | string | null;
  caracter?: string;
  [key: string]: unknown;
}

/**
 * Convierte un ApiRegistro (datos crudos de la API) a RawProcurementInput.
 * Construye la URL de detalle directamente desde uuid_procedimiento.
 */
export function apiRegistroToRawInput(item: ApiRegistro): RawProcurementInput {
  const uuid = item.uuid_procedimiento ?? '';
  const sourceUrl = uuid
    ? `https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/${uuid}/procedimiento`
    : '';

  // fecha_publicacion es el campo canónico; fecha_aclaraciones como fallback
  // si la API no incluye publicación explícita.
  const publicationDate = item.fecha_publicacion ?? item.fecha_aclaraciones ?? null;

  return {
    source: 'comprasmx',
    sourceUrl,
    externalId: item.numero_procedimiento,
    expedienteId: item.cod_expediente ?? null,
    licitationNumber: item.numero_procedimiento ?? null,
    procedureNumber: item.numero_procedimiento ?? null,
    title: item.nombre_procedimiento?.trim() || 'Sin Título',
    description: null,
    dependencyName: item.siglas?.trim() ?? null,
    buyingUnit: null,
    procedureType: item.tipo_procedimiento ?? null,
    status: item.estatus_alterno ?? null,           // → normalizeStatus() en normalizer
    publicationDate,                                 // fecha_publicacion ?? fecha_aclaraciones
    openingDate: item.fecha_apertura ?? null,        // fecha de apertura de propuestas
    awardDate: null,
    state: (item["entidad_federativa_contratacion"] as string | null) ?? null,
    municipality: null,
    amount: item.monto ?? null,
    currency: 'MXN',
    attachments: [],
    rawJson: item as Record<string, unknown>,
  };
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

/**
 * Candidatos de selector para el botón "Buscar".
 * El portal usa PrimeNG — el elemento puede ser <button>, <p-button> o tener clases variables.
 */
const BUSCAR_SELECTORS_LIST = [
  'button:has-text("Buscar")',
  'p-button:has-text("Buscar") button',
  '.p-button:has-text("Buscar")',
  'button[aria-label*="uscar"]',
  'button.p-button-primary',
  'input[type="submit"][value*="uscar"]',
  'button[type="submit"]',
];
const BUSCAR_SELECTOR_ANY = BUSCAR_SELECTORS_LIST.join(', ');

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
  ): Promise<{ rows: ListingRow[]; apiRegistros: Map<string, ApiRegistro>; pagesScanned: number }> {
    log.info({ baseUrl, maxPages }, "📋 Iniciando scan de listado ComprasMX");
    const allRows: ListingRow[] = [];
    let pagesScanned = 0;

    // ── Interceptar API del listado para capturar datos completos ──────────────
    // La API devuelve: { success, data: [{ registros: [...], paginacion: {...} }] }
    // Cada registro contiene todos los campos que necesitamos — no hace falta detail fetch.
    const apiRegistros = new Map<string, ApiRegistro>();

    const captureApiRegistros = (response: { url(): string; text(): Promise<string> }) => {
      if (!response.url().includes('/whitney/')) return;

      response.text().then((raw: string) => {
        let json: unknown;
        try { json = JSON.parse(raw); } catch { return; }

        const j = json as Record<string, unknown>;
        const dataArr = j?.data as unknown[] | undefined;
        const registros = (Array.isArray(dataArr) && dataArr.length > 0)
          ? ((dataArr[0] as Record<string, unknown>)?.registros as unknown[] | undefined)
          : undefined;

        if (!Array.isArray(registros) || registros.length === 0) return;

        // DIAG: imprimir campos disponibles del primer registro (solo una vez)
        if (apiRegistros.size === 0 && registros.length > 0) {
          const first = registros[0] as Record<string, unknown>;
          log.info(
            { campos: Object.keys(first), muestra: first },
            "🔬 DIAG campos del primer ApiRegistro"
          );
          // DIAG TEMPORAL — ver estructura exacta del primer registro en Railway
          // eslint-disable-next-line no-console
          console.log("🔬 [DIAG TEMPORAL] registros[0] crudo:\n" + JSON.stringify(first, null, 2));
        }

        let count = 0;
        for (const item of registros) {
          const it = item as ApiRegistro;
          if (it.numero_procedimiento) {
            apiRegistros.set(it.numero_procedimiento, it);
            count++;
          }
        }
        log.info({ count, total: apiRegistros.size, url: response.url() }, "📡 Registros API capturados");
      }).catch(() => {});
    };

    page.on('response', captureApiRegistros);

    try {
      log.info({ baseUrl }, "🌐 Navegando al portal ComprasMX...");
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

      // Esperar cualquiera de los selectores candidatos del botón Buscar
      log.info({ selector: BUSCAR_SELECTOR_ANY }, "⏳ Esperando botón Buscar...");
      await page.waitForSelector(BUSCAR_SELECTOR_ANY, { timeout: 20000 });

      // 5 s para que Angular hidrate el componente antes del click
      await page.waitForTimeout(5000);

      log.info("🔍 Activando búsqueda en el portal ComprasMX...");
      try {
        // ── Screenshot antes del click (diagnóstico) ─────────────────────────
        const screenshotBuf = await page.screenshot({ fullPage: false }).catch(() => null);
        if (screenshotBuf) {
          const b64 = screenshotBuf.toString("base64");
          log.info({ screenshotBytes: screenshotBuf.length }, "📸 Screenshot capturado antes del click en Buscar");
          // eslint-disable-next-line no-console
          console.log("📸 [SCREENSHOT-PRE-CLICK] data:image/png;base64," + b64);
        }

        // ── Configurar waitForResponse ANTES del click ────────────────────────
        const apiResponsePromise = page.waitForResponse(
          (resp) => resp.url().includes("/whitney/") && resp.status() === 200,
          { timeout: 60_000 },
        );

        // ── Click con fallback de selectores ──────────────────────────────────
        let clickedSelector = "";
        for (const sel of BUSCAR_SELECTORS_LIST) {
          try {
            const el = await page.$(sel);
            if (el && await el.isVisible()) {
              await el.click({ timeout: 8000 });
              clickedSelector = sel;
              log.info({ selector: sel }, "🖱 Click en Buscar ejecutado");
              break;
            }
          } catch { /* probar siguiente selector */ }
        }
        if (!clickedSelector) {
          // Log del HTML para diagnóstico antes de lanzar el error
          const html = await page.content().catch(() => "(sin HTML)");
          log.error(
            { html: html.slice(0, 3000), selectoresProbados: BUSCAR_SELECTORS_LIST },
            "❌ No se encontró el botón Buscar con ningún selector",
          );
          throw new Error(
            `Botón Buscar no encontrado. Selectores probados: [${BUSCAR_SELECTORS_LIST.join(", ")}]`,
          );
        }

        log.info("⏳ Esperando respuesta API /whitney/ (timeout: 60 s)...");

        // ── Intentar capturar respuesta vía interceptor ───────────────────────
        let apiOk = false;
        try {
          const apiResp = await apiResponsePromise;
          log.info(
            { url: apiResp.url(), status: apiResp.status() },
            "✅ Respuesta API /whitney/ recibida vía interceptor",
          );
          apiOk = true;
        } catch (waitErr) {
          log.warn(
            { waitErr: String(waitErr) },
            "⚠️ waitForResponse timeout — intentando fallback fetch directo desde browser...",
          );
        }

        // ── FALLBACK: fetch directo desde el contexto del browser ─────────────
        if (!apiOk) {
          const fallbackResult = await page.evaluate(async () => {
            try {
              const resp = await fetch("/whitney/sitiopublico/expedientes", {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ pagina: 1, registros_por_pagina: 50, filtros: {} }),
              });
              if (!resp.ok) return null;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return resp.json() as Promise<any>;
            } catch { return null; }
          }) as { data?: Array<{ registros?: unknown[] }> } | null;

          const fallbackRegistros = fallbackResult?.data?.[0]?.registros;
          if (Array.isArray(fallbackRegistros) && fallbackRegistros.length > 0) {
            const registros = fallbackRegistros as ApiRegistro[];
            log.info({ count: registros.length }, "✅ Fallback API directo exitoso — sintetizando filas");
            for (const it of registros) {
              if (!it.numero_procedimiento) continue;
              apiRegistros.set(it.numero_procedimiento, it);
              allRows.push({
                externalId: it.numero_procedimiento,
                title: it.nombre_procedimiento?.trim() ?? null,
                dependency: it.siglas?.trim() ?? null,
                status: it.estatus_alterno ?? null,
                visibleDate: it.fecha_publicacion ?? null,
                sourceUrl: "",
                rowText: [it.nombre_procedimiento, it.siglas, it.estatus_alterno]
                  .filter(Boolean).join(" "),
              });
            }
            pagesScanned = 1;
            page.off("response", captureApiRegistros);
            return { rows: allRows, apiRegistros, pagesScanned };
          }

          throw new Error(
            `⏱ API /whitney/ no respondió en 60 s y el fallback fetch directo también falló`,
          );
        }

        // ── Confirmar filas en el DOM ─────────────────────────────────────────
        await page.waitForFunction(
          `document.querySelectorAll(${JSON.stringify(SELECTORS.LISTING_ROW)}).length > 1`,
          { timeout: 15000 },
        );
        log.info("✅ Tabla de procedimientos cargada con resultados");
      } catch (buscarErr) {
        const html = await page.content().catch(() => "(no se pudo obtener HTML)");
        log.error(
          { buscarErr, html: html.slice(0, 2000) },
          "❌ FATAL: No se pudo activar Buscar o capturar respuesta API",
        );
        page.off("response", captureApiRegistros);
        return { rows: [], apiRegistros, pagesScanned: 0 };
      }
    } catch (err) {
      log.error({ err, baseUrl }, "❌ Error cargando portal ComprasMX");
      page.off("response", captureApiRegistros);
      return { rows: [], apiRegistros, pagesScanned: 0 };
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

      const uniqueOnPage = Array.from(new Map(rowsOnPage.map((r: ListingRow) => [r.externalId, r])).values());
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

    // Dar tiempo a que los handlers de response pendientes completen
    await page.waitForTimeout(500);
    page.off('response', captureApiRegistros);

    const coverage = allRows.length > 0
      ? Math.round((apiRegistros.size / allRows.length) * 100)
      : 0;
    log.info(
      { domRows: allRows.length, apiRegistros: apiRegistros.size, coverage: `${coverage}%` },
      "📊 Scan completado — cobertura API"
    );

    return { rows: allRows, apiRegistros, pagesScanned };
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
