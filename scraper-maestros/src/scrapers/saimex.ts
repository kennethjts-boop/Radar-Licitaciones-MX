import axios from "axios";
import * as cheerio from "cheerio";
import { Maestro } from "../types";

export async function scrapearSAIMEX(): Promise<Maestro[]> {
  console.log("[SAIMEX] Iniciando scraping...");
  const url = "https://www.saimex.org.mx/saimex/bus/busqueda.jsf";
  const maestros: Maestro[] = [];
  
  try {
    const res = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(res.data);
    
    // Attempting to parse responses containing "telesecundaria plantilla docente"
    console.log(`[SAIMEX] Cargó portal de búsqueda.`);
    return maestros;
  } catch (error) {
    console.warn(`[WARNING] SAIMEX falló: ${(error as Error).message}`);
    return [];
  }
}
