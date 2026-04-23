import axios from "axios";
import * as cheerio from "cheerio";
import { parse } from "csv-parse/sync";
import { Maestro } from "../types";

export async function scrapearDatosGobMx(): Promise<Maestro[]> {
  console.log("[datos.gob.mx] Iniciando scraping...");
  try {
    const url = "https://datos.gob.mx/busca/dataset/directorio-de-escuelas";
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);
    
    let csvUrl = "";
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && href.endsWith(".csv")) {
        csvUrl = href;
      }
    });

    if (!csvUrl) {
      console.warn("[WARNING] datos.gob.mx: No se encontró URL del CSV.");
      return [];
    }

    if (!csvUrl.startsWith("http")) {
      csvUrl = "https://datos.gob.mx" + csvUrl;
    }

    console.log(`[datos.gob.mx] Descargando CSV de: ${csvUrl}`);
    const csvRes = await axios.get(csvUrl, { responseType: "text" });
    const records = parse(csvRes.data, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true
    });

    const maestros: Maestro[] = [];
    
    for (const row of records) {
      const entidad = (row["ENTIDAD"] || "").toUpperCase();
      const nivel = (row["NIVEL"] || "").toUpperCase();
      
      if (entidad.includes("MORELOS") && nivel.includes("TELESECUNDARIA")) {
        maestros.push({
          nombre: row["DIRECTOR"] || "",
          cct: row["CLAVE"] || "",
          escuela: row["NOMBRE"] || "",
          municipio: row["MUNICIPIO"] || "",
          localidad: row["LOCALIDAD"] || "",
          direccion_escuela: row["DOMICILIO"] || "",
          telefono_escuela: row["TELEFONO"] || "",
          email_institucional: "",
          zona_escolar: "",
          supervisor_zona: "",
          funcion: "Director",
          horas_asignadas: 0,
          antiguedad: "",
          fuentes_consultadas: ["datos.gob.mx"]
        });
      }
    }
    
    console.log(`[datos.gob.mx] Encontrados ${maestros.length} registros.`);
    return maestros;
  } catch (err) {
    console.warn(`[WARNING] datos.gob.mx falló: ${(err as Error).message}`);
    return [];
  }
}
