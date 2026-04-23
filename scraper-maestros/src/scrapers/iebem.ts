import axios from "axios";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import { Maestro } from "../types";

export async function scrapearIEBEM(): Promise<Maestro[]> {
  console.log("[IEBEM] Iniciando scraping...");
  const url = "https://www.iebem.edu.mx/transparencia";
  const keywords = ["plantilla", "directorio", "personal", "docente", "estructura"];
  let maestros: Maestro[] = [];

  // Intento 1: Axios + Cheerio
  try {
    const res = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(res.data);
    
    let foundLinks = 0;
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().toLowerCase();
      
      if (href && keywords.some(k => text.includes(k) || href.toLowerCase().includes(k))) {
        foundLinks++;
      }
    });

    if (foundLinks > 0) {
      console.log(`[IEBEM] Encontrados ${foundLinks} links de interés (Intento 1).`);
      // Simular extracción
    } else {
      throw new Error("No links found via Cheerio");
    }
  } catch (error) {
    console.log("[IEBEM] Intento 1 falló, probando Puppeteer...");
    
    let browser;
    try {
      browser = await puppeteer.launch({ 
        args: ["--no-sandbox", "--disable-setuid-sandbox"] 
      });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll("a"));
        return anchors.map(a => ({ text: a.textContent || "", href: a.href }));
      });
      
      const relevant = links.filter(l => 
        keywords.some(k => l.text.toLowerCase().includes(k) || l.href.toLowerCase().includes(k))
      );
      
      console.log(`[IEBEM] Puppeteer encontró ${relevant.length} links relevantes.`);
    } catch (e) {
      console.warn(`[WARNING] IEBEM Puppeteer falló: ${(e as Error).message}`);
    } finally {
      if (browser) await browser.close();
    }
  }

  return maestros;
}
