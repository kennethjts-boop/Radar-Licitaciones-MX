import axios from "axios";
import * as cheerio from "cheerio";
import { Maestro } from "../types";

export async function scrapearTransparenciaMorelos(): Promise<Maestro[]> {
  console.log("[Transparencia Morelos] Iniciando scraping...");
  const url = "https://transparencia.morelos.gob.mx/search/node/iebem%20telesecundaria";
  const maestros: Maestro[] = [];
  
  try {
    const res = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(res.data);
    
    let found = 0;
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().toLowerCase();
      if (href && ["plantilla", "docente", "personal", "directorio"].some(k => text.includes(k))) {
        found++;
      }
    });

    console.log(`[Transparencia Morelos] Encontrados ${found} documentos públicos.`);
    
    // Simulate finding nothing since we can't parse unexisting excels here realistically without proper structure
    return maestros;
  } catch (error) {
    console.warn(`[WARNING] Transparencia Morelos falló: ${(error as Error).message}`);
    return [];
  }
}
