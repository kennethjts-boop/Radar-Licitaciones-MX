import puppeteer from "puppeteer";
import { Maestro } from "../types";

export async function scrapearSEP(): Promise<Maestro[]> {
  console.log("[SEP] Iniciando scraping...");
  const url = "https://www.sistemas.sep.gob.mx/consultaDatosEscola/";
  let browser;
  try {
    browser = await puppeteer.launch({ 
      args: ["--no-sandbox", "--disable-setuid-sandbox"] 
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    
    // Esperar 5 segundos
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const results = await page.evaluate(() => {
      // Intentar interactuar con la página si existen los elementos
      const maestrosArr: any[] = [];
      try {
        const entidadSelect = document.querySelector('select[name*="entidad"]') as HTMLSelectElement;
        const nivelSelect = document.querySelector('select[name*="nivel"]') as HTMLSelectElement;
        const buscarBtn = document.querySelector('input[type="submit"], button[type="submit"], button:contains("Buscar")') as HTMLElement;
        
        // Asignamos sin lanzar error
        if (entidadSelect && nivelSelect && buscarBtn) {
          // Lógica simplificada de interacción
          const optionsEntidad = Array.from(entidadSelect.options);
          const morelosOpt = optionsEntidad.find(o => o.text.toUpperCase().includes('MORELOS'));
          if (morelosOpt) entidadSelect.value = morelosOpt.value;

          const optionsNivel = Array.from(nivelSelect.options);
          const teleOpt = optionsNivel.find(o => o.text.toUpperCase().includes('TELESECUNDARIA'));
          if (teleOpt) nivelSelect.value = teleOpt.value;

          buscarBtn.click();
        }
        
        // Simular extracción de tablas si existen
        const rows = document.querySelectorAll('table tr');
        rows.forEach(r => {
          const cols = r.querySelectorAll('td');
          if (cols.length >= 5) {
            maestrosArr.push({
              cct: cols[0]?.textContent?.trim() || "",
              escuela: cols[1]?.textContent?.trim() || "",
              municipio: cols[2]?.textContent?.trim() || "",
              localidad: cols[3]?.textContent?.trim() || "",
              direccion_escuela: cols[4]?.textContent?.trim() || "",
              telefono_escuela: "",
              nombre: "Desconocido",
              funcion: "Docente"
            });
          }
        });
      } catch (e) {
        // ignora el error del evaluate
      }
      return maestrosArr;
    });

    console.log(`[SEP] Encontrados ${results.length} registros.`);
    
    return results.map(r => ({
      ...r,
      email_institucional: "",
      zona_escolar: "",
      supervisor_zona: "",
      horas_asignadas: 0,
      antiguedad: "",
      fuentes_consultadas: ["SEP Consulta"]
    }));
  } catch (error) {
    console.warn(`[WARNING] SEP falló: ${(error as Error).message}`);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}
