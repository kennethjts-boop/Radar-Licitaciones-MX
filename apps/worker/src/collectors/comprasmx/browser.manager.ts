/**
 * BROWSER MANAGER — Infraestructura segura para Playwright.
 * Utiliza configuraciones defensivas (stealth y timeout) para no bloquear
 * el worker completo ni consumir excesiva memoria RAM.
 */
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { createModuleLogger } from "../../core/logger";
import { getConfig } from "../../config/env";

const log = createModuleLogger("browser-manager");
const BROWSER_LAUNCH_TIMEOUT_MS = 60_000;
const DEFAULT_BROWSER_OPERATION_TIMEOUT_MS = 5 * 60 * 1000;

// Chrome 124 real — sincronizado con releases.chromium.org/2024
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  /**
   * Arranca el navegador si no existe. Configuración "headless" según entorno.
   */
  async launch(): Promise<void> {
    if (this.browser) return;

    const config = getConfig();
    log.info(
      {
        headless: config.PLAYWRIGHT_HEADLESS,
        ignoreHTTPSErrors: config.PLAYWRIGHT_IGNORE_HTTPS_ERRORS,
      },
      "🚀 Launching Chromium browser...",
    );

    this.browser = await chromium.launch({
      headless: config.PLAYWRIGHT_HEADLESS,
      timeout: BROWSER_LAUNCH_TIMEOUT_MS,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", // Crucial para evitar OOM crashes en Docker
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--disable-features=IsolateOrigins,site-per-process",
        "--blink-settings=imagesEnabled=false", // Bloquea carga de imágenes para CPU/RAM
      ],
    });

    log.info("✅ Browser launched");
  }

  /**
   * Crea un nuevo contexto limpio per collect_run.
   */
  async createContext(): Promise<BrowserContext> {
    if (!this.browser) {
      throw new Error("Browser is not launched. Call launch() first.");
    }

    // Si ya había contexto, cerrarlo para evitar filtración de Memoria/Cookies
    if (this.context) {
      await this.context.close();
    }

    const config = getConfig();
    let proxy: { server: string } | undefined;

    if (config.PROXY_ENABLED) {
      const proxyServer = config.HTTP_PROXY || config.HTTPS_PROXY;
      if (proxyServer) {
        proxy = { server: proxyServer };
        // Enmascarar credenciales en el log (user:password@host -> user:***@host)
        const maskedServer = proxyServer.replace(/:(\S+)@/, ":***@");
        log.info(
          { server: maskedServer, mode: "with_proxy" },
          "🌐 Browser context: proxy ACTIVO",
        );
      } else {
        log.warn(
          "PROXY_ENABLED=true pero HTTP_PROXY y HTTPS_PROXY están vacíos — corriendo SIN proxy",
        );
      }
    } else {
      log.info(
        { mode: "no_proxy" },
        "🚀 Browser context: corriendo SIN proxy (PROXY_ENABLED=false)",
      );
    }

    this.context = await this.browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1366, height: 768 },
      locale: "es-MX",
      timezoneId: "America/Mexico_City",
      javaScriptEnabled: true,
      bypassCSP: true,
      ignoreHTTPSErrors: config.PLAYWRIGHT_IGNORE_HTTPS_ERRORS,
      extraHTTPHeaders: {
        "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        DNT: "1",
      },
      proxy,
    });

    this.context.setDefaultTimeout(30000);
    this.context.setDefaultNavigationTimeout(45000);

    return this.context;
  }

  /**
   * Apaga globalmente contexto y navegador.
   */
  async close(): Promise<void> {
    log.info("🛑 Closing browser subsystem...");
    const closeWithTimeout = async (
      label: string,
      closePromise: Promise<unknown>,
      timeoutMs = 10_000,
    ): Promise<void> => {
      let timeoutHandle: NodeJS.Timeout | null = null;
      try {
        await Promise.race([
          closePromise,
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(
              () => reject(new Error(`${label} close timed out after ${timeoutMs}ms`)),
              timeoutMs,
            );
          }),
        ]);
      } catch (err) {
        log.warn({ err }, `⚠️ ${label} did not close cleanly`);
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    };

    try {
      if (this.context) {
        await closeWithTimeout("Browser context", this.context.close());
        this.context = null;
      }
      if (this.browser) {
        await closeWithTimeout("Browser", this.browser.close());
        this.browser = null;
      }
      log.info("✅ Browser closed gracefully");
    } catch (err) {
      log.error({ err }, "❌ Error closing browser");
    }
  }

  /**
   * Helper que envuelve un context temporal (crea, corre, cierra).
   */
  static async withContext<T>(
    operation: (page: Page, context: BrowserContext) => Promise<T>,
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    const manager = new BrowserManager();
    let forcedClosePromise: Promise<void> | null = null;
    const timeoutMs = options.timeoutMs ?? DEFAULT_BROWSER_OPERATION_TIMEOUT_MS;
    let timeoutHandle: NodeJS.Timeout | null = null;

    const timeoutPromise = timeoutMs > 0
      ? new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            log.error(
              { timeoutMs },
              "⏱ Browser operation timeout — cerrando browser para abortar operaciones pendientes",
            );
            forcedClosePromise = manager.close().catch((err) => {
              log.error({ err }, "❌ Error cerrando browser tras timeout");
            });
            reject(
              new Error(
                `Browser operation timed out after ${timeoutMs}ms`,
              ),
            );
          }, timeoutMs);
        })
      : null;

    const runBrowserOperation = async (): Promise<T> => {
      await manager.launch();
      const context = await manager.createContext();
      const page = await context.newPage();
      return operation(page, context);
    };

    try {
      if (timeoutMs <= 0) {
        return await runBrowserOperation();
      }

      return await Promise.race([runBrowserOperation(), timeoutPromise!]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (forcedClosePromise) {
        await forcedClosePromise;
      } else {
        await manager.close();
      }
    }
  }
}
