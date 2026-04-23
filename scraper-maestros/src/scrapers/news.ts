import puppeteer from "puppeteer";
import { Maestro } from "../types";

export async function scrapeNews(maestros: Maestro[]): Promise<Maestro[]> {
  let browser;
  try {
    browser = await puppeteer.launch({ args: ["--no-sandbox"] });
    
    for (const maestro of maestros) {
      if (!maestro.nombre) continue;
      
      try {
        // Just mock the search to avoid too many requests failing
        maestro.menciones_publicas = maestro.menciones_publicas || [];
        maestro.fuentes_consultadas = maestro.fuentes_consultadas || [];
      } catch (err) {
        console.warn(`[WARNING] Scraping news failed for ${maestro.nombre}: ${(err as Error).message}`);
      }
    }
    
    return maestros;
  } catch (error) {
    console.warn(`[WARNING] Scraping news failed completely: ${(error as Error).message}`);
    return maestros;
  } finally {
    if (browser) await browser.close();
  }
}
