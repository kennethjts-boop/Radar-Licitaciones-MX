/**
 * BROWSER MANAGER — Infraestructura segura para Playwright.
 * Utiliza configuraciones defensivas (stealth y timeout) para no bloquear
 * el worker completo ni consumir excesiva memoria RAM.
 */
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { createModuleLogger } from "../../core/logger";
import { getConfig } from "../../config/env";

const log = createModuleLogger("browser-manager");

// Agent conservador y estático
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
      { headless: config.PLAYWRIGHT_HEADLESS },
      "🚀 Launching Chromium browser...",
    );

    this.browser = await chromium.launch({
      headless: config.PLAYWRIGHT_HEADLESS,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", // Crucial para evitar OOM crashes en Docker
        "--disable-gpu",
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
    try {
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close();
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
  ): Promise<T> {
    const manager = new BrowserManager();
    await manager.launch();
    try {
      const context = await manager.createContext();
      const page = await context.newPage();
      return await operation(page, context);
    } finally {
      await manager.close();
    }
  }
}
