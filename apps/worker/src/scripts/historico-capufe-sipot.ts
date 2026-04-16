import "dotenv/config";
import axios from "axios";
import * as fs from "fs/promises";
import * as path from "path";
import process from "process";
import { createModuleLogger } from "../core/logger";

const log = createModuleLogger("historico-capufe-sipot");

const DEPENDENCIA_NOMBRE = "Caminos y Puentes Federales de Ingresos y Servicios Conexos";
const ARTICULO = "70";
const FRACCIONES = ["XXVII", "XXVIIIb"];

const KEYWORDS_DEFAULT = [
  "control de transito", "señalizacion vial", "semaforos", "telepeaje", "iave", "televia", "tag",
  "mantenimiento a equipo", "mantenimiento de equipo", "rollos termicos", "papel termico",
  "comprobantes", "cctv caseta", "barreras vehiculares", "aforo vehicular", "sistema electronico de cobro",
  "refacciones", "its", "plumas de caseta", "caseta", "plaza de cobro"
];

const YEARS_BACK_DEFAULT = 5;
const OUTPUT_DIR = path.join(process.cwd(), "data");
const RATE_LIMIT_MS = 1000;

interface SipotRecord {
  año: string;
  fraccion: string;
  numero_contrato: string;
  objeto: string;
  proveedor: string;
  monto: string;
  fecha_adjudicacion: string;
  url_contrato_pdf: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// TODO: validar endpoint SIPOT vigente
// El endpoint de la PNT cambia frecuentemente. El usuario debe validar el endpoint actual capturando
// una petición en https://consultapublicamx.plataformadetransparencia.org.mx/ y reemplazando esta función.
async function fetchSipotPagina(año: string, fraccion: string, pagina: number): Promise<any[]> {
  /*
  const payload = {
    // Reemplazar con el payload capturado en DevTools
  };
  
  try {
    const response = await axios.post("URL_ENDPOINT_CAPTURADO", payload, {
      headers: {
        // Headers necesarios (Tokens, Cookies, etc.)
      },
      timeout: 30000
    });
    return response.data; // Ajustar a la estructura real de la respuesta
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      throw new Error("Rate limit");
    }
    throw err;
  }
  */
  log.warn("Llamada SIPOT simulada - Reemplaza fetchSipotPagina con la implementación real validada.");
  return []; // Modificar esto con la integración real
}

/*
// Stub opcional si se requiere scrapear en lugar del API
async function fetchSipotViaBuscadorWeb(año: string, fraccion: string, pagina: number): Promise<any[]> {
  // Implementación de scraping
  return [];
}
*/

function normalizeText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function filtrarPorKeywords(registros: any[], keywords: string[]): SipotRecord[] {
  const resultados: SipotRecord[] = [];
  const normalizedKeywords = keywords.map(normalizeText);

  for (const reg of registros) {
    // NOTA: Ajustar estos campos según la respuesta real de la API de SIPOT
    const objetoContrato = String(reg.objetoContrato || reg.descripcion || reg.concepto || "").trim();
    const textoNormalizado = normalizeText(objetoContrato);

    const isMatch = normalizedKeywords.some(kw => textoNormalizado.includes(kw));

    if (isMatch) {
      resultados.push({
        año: String(reg.ejercicio || "N/A"),
        fraccion: String(reg.fraccion || "N/A"),
        numero_contrato: String(reg.numeroContrato || reg.folio || "N/A"),
        objeto: objetoContrato,
        proveedor: String(reg.proveedor || reg.contratista || "N/A"),
        monto: String(reg.monto || "N/A"),
        fecha_adjudicacion: String(reg.fechaAdjudicacion || reg.fechaContrato || "N/A"),
        url_contrato_pdf: String(reg.hipervinculoContrato || reg.urlContrato || "N/A"),
      });
    }
  }

  return resultados;
}

async function escribirCSV(registros: SipotRecord[], ruta: string): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const headers = ["año", "fraccion", "numero_contrato", "objeto", "proveedor", "monto", "fecha_adjudicacion", "url_contrato_pdf"];
  const filas = [headers.join(",")];

  for (const reg of registros) {
    const fila = headers.map(h => {
      let val = reg[h as keyof SipotRecord] || "";
      // Escapar comillas dobles y envolver en comillas si hay comas, comillas o saltos de línea
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    });
    filas.push(fila.join(","));
  }

  await fs.writeFile(ruta, filas.join("\n"), "utf-8");
}

async function tryFetchWithRetry(año: string, fraccion: string, pagina: number): Promise<any[]> {
  const maxRetries = 3;
  let delay = 1000;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetchSipotPagina(año, fraccion, pagina);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err), attempt: i + 1 }, "Error fetching SIPOT, retrying...");
      if (i < maxRetries - 1) {
        await sleep(delay);
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
  return [];
}

async function main() {
  const args = process.argv.slice(2);
  let parsedYears = YEARS_BACK_DEFAULT;
  let parsedYearId = null;
  let parsedKeywords = [...KEYWORDS_DEFAULT];
  let isDryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--years" && i + 1 < args.length) {
      parsedYears = parseInt(args[++i], 10) || YEARS_BACK_DEFAULT;
    } else if (args[i] === "--year" && i + 1 < args.length) {
      parsedYearId = parseInt(args[++i], 10);
    } else if (args[i] === "--keywords" && i + 1 < args.length) {
      parsedKeywords = args[++i].split(",").map(k => k.trim());
    } else if (args[i] === "--dry-run") {
      isDryRun = true;
    }
  }

  const currentYear = new Date().getFullYear();
  const targetYears = parsedYearId
    ? [parsedYearId]
    : Array.from({ length: parsedYears + 1 }, (_, i) => currentYear - i).sort();

  log.info({ years: targetYears, variables: parsedKeywords.length, dryRun: isDryRun }, "Iniciando consulta histórica CAPUFE en SIPOT");

  const allFilteredRecords: SipotRecord[] = [];
  const proveedorCount: Record<string, number> = {};
  const yearDistribution: Record<string, number> = {};

  for (const year of targetYears) {
    yearDistribution[year] = 0;
    for (const fraccion of FRACCIONES) {
      let page = 1;
      let hasMore = true;

      log.info({ year, fraccion }, "Consultando fracción por año");

      while (hasMore) {
        try {
          const registrosPagina = await tryFetchWithRetry(year.toString(), fraccion, page);

          if (!registrosPagina || registrosPagina.length === 0) {
            hasMore = false;
            break;
          }

          const filtrados = filtrarPorKeywords(registrosPagina, parsedKeywords);
          allFilteredRecords.push(...filtrados);
          
          for (const rec of filtrados) {
             yearDistribution[year]++;
             const provName = normalizeText(rec.proveedor || "Desconocido");
             proveedorCount[provName] = (proveedorCount[provName] || 0) + 1;
          }
          
          // NOTA: Implementar lógica real de paginación según la API.
          // Si sabemos que devuelve P_SIZE, y registosPagina < P_SIZE, hasMore = false
          hasMore = false; // Stub para evitar loop infinito en versión inicial

          await sleep(RATE_LIMIT_MS);
          page++;
        } catch (error) {
           log.error({ err: error instanceof Error ? error.message : String(error), year, fraccion, page }, "Fallo permanente al consultar página");
           hasMore = false; // Skip rest of this fraction on hard error
        }
      }
    }
  }

  // Deduplicar por número de contrato (mismo hash)
  const uniqueRecordsMap = new Map<string, SipotRecord>();
  for (const record of allFilteredRecords) {
      const key = `${record.numero_contrato}-${record.proveedor}`;
      if (!uniqueRecordsMap.has(key)) {
         uniqueRecordsMap.set(key, record);
      }
  }
  const deduplicatedRecords = Array.from(uniqueRecordsMap.values());

  if (isDryRun) {
    log.info("--- MODO DRY RUN ---");
    console.table(deduplicatedRecords.slice(0, 10));
  } else {
    const defaultDate = new Date().toISOString().split("T")[0];
    const outputFile = path.join(OUTPUT_DIR, `historico-capufe-${defaultDate}.csv`);
    await escribirCSV(deduplicatedRecords, outputFile);
    log.info({ outputFile, matches: deduplicatedRecords.length }, "Resultados guardados exitosamente");
  }

  const topProviders = Object.entries(proveedorCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([prov, count]) => `${prov} (${count})`);

  log.info({
    matchesTotales: deduplicatedRecords.length,
    añosConsulta: targetYears,
    distribucionPorAño: yearDistribution,
    topProveedores: topProviders
  }, "Resumen de ejecución de script histórico");

}

if (require.main === module) {
  main().catch(err => {
    log.error({ err: err instanceof Error ? err.stack : String(err) }, "Error fatal en script histórico");
    process.exit(1);
  });
}
