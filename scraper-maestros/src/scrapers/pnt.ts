import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import readline from 'readline';
import { Maestro } from '../types';

puppeteer.use(StealthPlugin());

function promptUser(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

export async function scrapearPNT(): Promise<Maestro[]> {
  console.log("\n[PNT] Iniciando scraper Híbrido (Headful)...");
  console.log("[PNT] Se abrirá un navegador Chrome.");
  console.log("[PNT] Por favor completa el captcha de Cloudflare si aparece.");
  console.log("[PNT] Luego, navega en la PNT, busca la nómina del IEBEM (Telesecundarias) y cuando veas la tabla de resultados, vuelve aquí.");
  
  const browser = await puppeteer.launch({
    headless: false, // ¡Visible para el usuario!
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    defaultViewport: null,
    args: ['--start-maximized', '--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();
  
  try {
    await page.goto('https://consultapublicamx.plataformadetransparencia.org.mx/vut-web/faces/view/consultaPublica.xhtml', { waitUntil: 'domcontentloaded' });
  } catch (err) {
    console.error("[PNT] Error inicial al cargar la PNT. Asegúrate de tener conexión.", err);
  }

  await promptUser("\n➡️  Presiona ENTER cuando la TABLA DE RESULTADOS esté completamente cargada y visible en el navegador...");

  console.log("[PNT] Iniciando extracción de la tabla visible...");
  
  const maestros: Maestro[] = [];
  let hasNextPage = true;
  let pageNumber = 1;

  while (hasNextPage) {
    console.log(`[PNT] Extrayendo página ${pageNumber}...`);
    
    // Extracción
    const rows = await page.evaluate(() => {
      const data: any[] = [];
      // Intentar encontrar las tablas de resultados (la PNT usa dataTables o similares de JSF)
      const tableRows = document.querySelectorAll('table tbody tr');
      
      tableRows.forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() || '');
        if (cells.length > 3) {
          data.push(cells);
        }
      });
      return data;
    });

    if (rows.length === 0) {
      console.log("[PNT] No se encontraron filas en esta página. ¿Estás seguro de que la tabla está visible?");
      break;
    }

    // Mapeo rudimentario asumiendo columnas típicas de nómina:
    // PNT suele tener: Ejercicio, Periodo, Nombre, Primer Apellido, Segundo Apellido, Puesto, Área, Sueldo...
    for (const cells of rows) {
      // Como no conocemos el índice exacto, concatenamos el nombre si existe, o guardamos toda la info.
      // Normalmente el nombre está en las columnas 5,6,7 o juntas.
      // Buscamos heurísticamente algo que parezca nombre
      let nombreStr = "";
      for(let i=0; i<cells.length; i++) {
         if(cells[i].includes("TELESECUNDARIA") || cells[i].includes("DOCENTE") || cells[i].includes("DIRECTOR")) continue;
         // Si es un string largo y todo mayúsculas, podría ser el nombre
         if(cells[i].length > 5 && cells[i] === cells[i].toUpperCase() && !cells[i].includes("$")) {
             nombreStr += cells[i] + " ";
         }
      }
      nombreStr = nombreStr.trim() || cells.join(" | ").substring(0, 50);

      maestros.push({
        nombre: nombreStr || "N/D",
        cct: "N/D", // PNT nómina no siempre trae el CCT explícito, a veces solo el centro de trabajo
        escuela: "TELESECUNDARIA (Vía Nómina PNT)",
        municipio: "Morelos (Estatal)", // PNT nómina IEBEM es a nivel estatal
        localidad: "N/D",
        direccion_escuela: "N/D",
        telefono_escuela: "N/D",
        email_institucional: "N/D",
        zona_escolar: "N/D",
        supervisor_zona: "N/D",
        funcion: cells.find(c => /DOCENTE|DIRECTOR|PROFESOR|MAESTRO/i.test(c)) || "Docente FONE",
        horas_asignadas: 0,
        antiguedad: "N/D",
        fuentes_consultadas: ["Plataforma Nacional de Transparencia (PNT)"]
      });
    }

    // Paginación: buscar el botón de siguiente
    hasNextPage = await page.evaluate(() => {
      // PNT usa clases ui-paginator-next
      const nextBtn = document.querySelector('.ui-paginator-next') as HTMLElement;
      if (nextBtn && !nextBtn.classList.contains('ui-state-disabled')) {
        nextBtn.click();
        return true;
      }
      
      // Intentar encontrar algun texto "Siguiente" o ">"
      const links = Array.from(document.querySelectorAll('a, button'));
      const nextTextBtn = links.find(el => el.textContent?.trim() === 'Siguiente' || el.textContent?.trim() === '>') as HTMLElement;
      if (nextTextBtn && !nextTextBtn.hasAttribute('disabled')) {
        nextTextBtn.click();
        return true;
      }
      
      return false;
    });

    if (hasNextPage) {
      pageNumber++;
      // Esperar a que la tabla se actualice
      await new Promise(r => setTimeout(r, 4000)); 
    }
  }

  console.log(`[PNT] Extracción terminada. Total filas base extraídas: ${maestros.length}`);
  await browser.close();

  return maestros;
}
