import "dotenv/config";
import axios from "axios";
import * as fs from "fs/promises";
import * as path from "path";
import process from "process";
import { chromium } from "playwright";
import { createModuleLogger } from "../core/logger";
import { sendTelegramDocument, sendTelegramMessage } from "../alerts/telegram.alerts";

const log = createModuleLogger("historico-capufe-sipot");

const OUTPUT_DIR = path.join(process.cwd(), "data");
const RATE_LIMIT_MS = 1000;
const ENDPOINT_URL = "https://backbuscadortematico.plataformadetransparencia.org.mx/api/tematico/buscador/consulta";

interface NormalizedResult {
  contratoDetectado: string;
  proveedor: string;
  objeto: string;
  monto: string;
  fecha: string;
  dependencia: string;
  rawRecord: any;
  fuente: "SIPOT";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function querySipotExact(queryString: string): Promise<any[]> {
  const payload = {
    contenido: queryString,
    cantidad: 50,
    numeroPagina: 0,
    coleccion: "CONTRATOS",
    dePaginador: false,
    filtroSeleccionado: "",
    idCompartido: "",
    organosGarantes: { seleccion: [], descartado: [] },
    sujetosObligados: { seleccion: [], descartado: [] },
    anioFechaInicio: { seleccion: [], descartado: [] },
    tipoOrdenamiento: "COINCIDENCIA",
  };

  try {
    const response = await axios.post(ENDPOINT_URL, payload, { timeout: 30000 });
    const records = response.data?.payload?.datosSolr || response.data?.paylod?.datosSolr || [];
    return Array.isArray(records) ? records : [];
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      log.warn({ status: err.response.status, data: err.response.data }, "SIPOT HTTP error");
    } else {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "SIPOT request error");
    }
    return [];
  }
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function detectContract(record: any, targetContracts: string[]): string | null {
  const fieldsStr = JSON.stringify(record);
  const normalizedStr = normalizeText(fieldsStr);

  for (const contract of targetContracts) {
    const normContract = normalizeText(contract);
    if (normalizedStr.includes(normContract)) {
      return contract;
    }
  }
  return null;
}

function normalizeResult(record: any, detected: string): NormalizedResult {
  return {
    contratoDetectado: detected,
    proveedor: String(
      record.proveedor || record.nombreContratista || record.nombreComercial || "N/A"
    ),
    objeto: String(record.objetoContrato || record.descripcion || record.concepto || record.titulo || "N/A"),
    monto: String(record.montoContrato || record.montoMaximo || record.montoMinimo || record.montoTotal || "N/A"),
    fecha: String(record.fechaContrato || record.fechaCelebracion || record.fechaInicio || "N/A"),
    dependencia: String(record.nombreSujetoObligado || record.institucion || "N/A"),
    rawRecord: record,
    fuente: "SIPOT",
  };
}

async function exportCSV(records: NormalizedResult[], filePath: string) {
  const headers = [
    "contrato_detectado",
    "proveedor",
    "objeto",
    "monto",
    "fecha",
    "dependencia",
    "fuente",
  ];
  const rows = [headers.join(",")];
  for (const rec of records) {
    const values = headers.map((h) => {
      let val = String(rec[h as keyof NormalizedResult] || "");
      if (typeof rec[h as keyof NormalizedResult] === "object") val = "";
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    });
    rows.push(values.join(","));
  }
  await fs.writeFile(filePath, rows.join("\n"), "utf-8");
}

async function exportPDF(records: NormalizedResult[], targetContracts: string[], filePath: string) {
  const html = `
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 20px; font-size: 14px; }
          .header { margin-bottom: 30px; }
          .title { font-size: 20px; font-weight: bold; margin-bottom: 20px; color: #111; }
          .subtitle { font-size: 13px; color: #444; margin-bottom: 8px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
          th, td { border: 1px solid #ccc; padding: 10px; text-align: left; vertical-align: top; }
          th { background-color: #f5f5f5; font-weight: bold; }
          td.objeto { min-width: 200px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">Reporte de coincidencias SIPOT — Contratos CAPUFE/FONADIN</div>
          <div class="subtitle"><strong>Fecha de generación:</strong> ${new Date().toLocaleString()}</div>
          <div class="subtitle"><strong>Endpoint consultado:</strong> ${ENDPOINT_URL}</div>
          <div class="subtitle"><strong>Contratos objetivo:</strong> ${targetContracts.join(", ")}</div>
          <div class="subtitle"><strong>Total de coincidencias encontradas:</strong> ${records.length}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Contrato Detectado</th>
              <th>Proveedor</th>
              <th>Objeto/Descripción</th>
              <th>Monto</th>
              <th>Fecha</th>
              <th>Dependencia</th>
            </tr>
          </thead>
          <tbody>
            ${records
              .map(
                (r) => `
              <tr>
                <td>${r.contratoDetectado}</td>
                <td>${r.proveedor}</td>
                <td class="objeto">${r.objeto}</td>
                <td>${r.monto}</td>
                <td>${r.fecha}</td>
                <td>${r.dependencia}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html);
  await page.pdf({ path: filePath, format: "A4", landscape: true });
  await browser.close();
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const args = process.argv.slice(2);
  let targetContracts = ["4500036766", "4500036767"];
  const customContracts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--contract" && i + 1 < args.length) {
      customContracts.push(args[++i].trim());
    }
  }

  if (customContracts.length > 0) {
    targetContracts = customContracts;
  }

  const queries = targetContracts.flatMap((c) => {
    const list = [c, `"${c}"`];
    if (c === "4500036766") list.push(`${c} CAPUFE`);
    else if (c === "4500036767") list.push(`${c} FONADIN`);
    else list.push(`${c} CAPUFE`);
    return list;
  });

  const uniqueQueries = [...new Set(queries)];

  log.info({ targetContracts, queriesToRun: uniqueQueries.length }, "Iniciando búsqueda exacta SIPOT");

  const allRawRecords: any[] = [];
  const normalizedResults: NormalizedResult[] = [];
  const uniqueSignatures = new Set<string>();

  for (const q of uniqueQueries) {
    log.info({ query: q }, "Ejecutando query exacta SIPOT");
    const records = await querySipotExact(q);

    if (records.length === 0) {
      log.debug({ query: q }, "Endpoint devolvió vacío, siguiente...");
    }

    for (const record of records) {
      allRawRecords.push(record);

      const detected = detectContract(record, targetContracts);
      if (detected) {
        const normalized = normalizeResult(record, detected);
        const dedupeKey = `${normalized.contratoDetectado}-${normalized.proveedor}-${normalized.objeto}`;

        if (!uniqueSignatures.has(dedupeKey)) {
          uniqueSignatures.add(dedupeKey);
          normalizedResults.push(normalized);
        }
      }
    }

    await sleep(RATE_LIMIT_MS);
  }

  const jsonPath = path.join(OUTPUT_DIR, "historico-capufe-contratos-raw.json");
  await fs.writeFile(jsonPath, JSON.stringify(allRawRecords, null, 2), "utf-8");
  log.info({ jsonPath, rawCount: allRawRecords.length }, "JSON crudo exportado");

  const csvPath = path.join(OUTPUT_DIR, "historico-capufe-contratos.csv");
  await exportCSV(normalizedResults, csvPath);
  log.info({ csvPath, normalizedCount: normalizedResults.length }, "CSV resumido exportado");

  const pdfPath = path.join(OUTPUT_DIR, "historico-capufe-contratos.pdf");
  await exportPDF(normalizedResults, targetContracts, pdfPath);
  log.info({ pdfPath }, "PDF ejecutivo generado");

  if (normalizedResults.length > 0) {
    const telegramMsg = `📄 Coincidencias SIPOT detectadas para contratos ${targetContracts.join(" / ")} — total: ${
      normalizedResults.length
    }`;
    try {
      await sendTelegramMessage(telegramMsg, "HTML");
      await sendTelegramDocument("Reporte Ejecutivo PDF", pdfPath);
      await sendTelegramDocument("Datos Exportados CSV", csvPath);
      log.info("Reportes enviados exitosamente por Telegram");
    } catch (err) {
      log.error({ err }, "Error enviando a Telegram");
    }
  } else {
    log.info(`No hubo coincidencias SIPOT para contratos ${targetContracts.join(" y ")}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    log.error({ err: err instanceof Error ? err.stack : String(err) }, "Error fatal en script histórico");
    process.exit(1);
  });
}
