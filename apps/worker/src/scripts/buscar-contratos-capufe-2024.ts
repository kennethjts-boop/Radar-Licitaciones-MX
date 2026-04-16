import "dotenv/config";
import axios from "axios";
import * as fs from "fs/promises";
import * as path from "path";
import process from "process";
import { chromium } from "playwright";
// @ts-ignore
import pdfParse from "pdf-parse";
import { createModuleLogger } from "../core/logger";
import { sendTelegramDocument, sendTelegramMessage } from "../alerts/telegram.alerts";

const log = createModuleLogger("buscar-contratos-capufe-2024");

const OUTPUT_DIR = path.join(process.cwd(), "data");
const RATE_LIMIT_MS = 1500;
const SIPOT_ENDPOINT_URL = "https://backbuscadortematico.plataformadetransparencia.org.mx/api/tematico/buscador/consulta";

interface SearchResult {
  tituloDetectado: string;
  anioDetectado: string;
  dependencia: string;
  proveedorDetectado: string;
  tipoDocumento: string;
  numeroContrato: string;
  numeroLicitacion: string;
  montoDetectado: string;
  relevanciaScore: number;
  razonesMatch: string[];
  pdfUrl: string;
  sourceUrl: string;
  snippetEvidencia: string;
  textoExtraidoPreview: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeText(text: string): string {
  if (!text) return "";
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

import * as cheerio from "cheerio";

// ... existing imports ...

async function querySIPOT(query: string): Promise<any[]> {
  const payload = {
    contenido: query,
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
    const response = await axios.post(SIPOT_ENDPOINT_URL, payload, { timeout: 30000 });
    const records = response.data?.payload?.datosSolr || response.data?.paylod?.datosSolr || [];
    return Array.isArray(records) ? records : [];
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "SIPOT request error");
    return [];
  }
}

async function searchDuckDuckGo(query: string): Promise<string[]> {
  try {
    const response = await axios.post(
      "https://lite.duckduckgo.com/lite/",
      `q=${encodeURIComponent(query)}`,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 15000,
      }
    );

    const $ = cheerio.load(response.data);
    const results: string[] = [];

    $("a").each((_, el) => {
      const url = $(el).attr("href");
      if (url && url.toLowerCase().includes(".pdf")) {
        // Handle DDG tracked urls if needed, though Lite usually gives direct links or track links
        // We'll decode if it's a redirect
        if (url.includes("uddg=")) {
          const match = url.match(/uddg=([^&]+)/);
          if (match) results.push(decodeURIComponent(match[1]));
        } else if (url.startsWith("http")) {
          results.push(url);
        }
      }
    });

    return [...new Set(results)]; // filter distinct
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "DuckDuckGo search error");
    return [];
  }
}

async function downloadAndParsePDF(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 20000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const data = await pdfParse(response.data);
    return data.text;
  } catch (err) {
    log.debug({ url, err: err instanceof Error ? err.message : String(err) }, "Failed to extract PDF");
    return null;
  }
}

function classifyRelevance(
  text: string,
  url: string,
  sourceUrl: string,
  metadata?: any
): SearchResult | null {
  const normText = normalizeText(text);

  const keywords = {
    proveedor: "ofi store",
    dependencias: ["capufe", "caminos y puentes", "fonadin", "fondo nacional de infraestructura"],
    anios: ["2024", "2 0 2 4"],
    servicios: [
      "mantenimiento preventivo",
      "mantenimiento correctivo",
      "control de transito",
      "telepeaje",
      "peaje",
      "plaza de cobro",
      "caseta",
    ],
    docTypes: ["contrato", "fallo", "convocatoria", "adjudicacion", "anexo"],
    zonas: ["mexico-puebla", "mexico puebla", "red capufe", "red fonadin"]
  };

  let score = 0;
  const razonesMatch: string[] = [];

  const hasOfiStore = normText.includes(keywords.proveedor) || normalizeText(metadata?.proveedor || "").includes(keywords.proveedor);
  const hasDependencia = keywords.dependencias.some((d) => normText.includes(d) || normalizeText(metadata?.dependencia || "").includes(d));
  
  if (hasOfiStore) { score += 50; razonesMatch.push("Contiene OFI STORE"); }
  if (hasDependencia) { score += 20; razonesMatch.push("Contiene dependencia destino (CAPUFE/FONADIN)"); }
  
  let matchesServicios = 0;
  for (const s of keywords.servicios) {
    if (normText.includes(s) || normalizeText(metadata?.objeto || "").includes(s)) {
      matchesServicios++;
    }
  }
  if (matchesServicios > 0) {
    score += matchesServicios * 10;
    razonesMatch.push(`Coincide con ${matchesServicios} términos de servicio`);
  }

  const has2024 = keywords.anios.some(a => normText.includes(a) || normalizeText(metadata?.anio || "").includes(a) || url.includes("2024"));
  if (has2024) {
    score += 15;
    razonesMatch.push("Mención al año 2024");
  }

  let tipoDocStr = "otro";
  for (const t of keywords.docTypes) {
    if (normText.includes(t)) {
      tipoDocStr = t;
      score += 5;
      razonesMatch.push(`Detectado tipo de documento: ${t}`);
      break;
    }
  }

  // Reglas de negocio rígidas:
  const isRelevant = 
    (hasOfiStore && hasDependencia) || 
    (hasDependencia && matchesServicios >= 2 && has2024) ||
    (matchesServicios >= 3 && has2024) ||
    (hasOfiStore && has2024) ||
    (score >= 40); // Backup threshold

  if (!isRelevant) return null;

  // Extracción de metadatos mediante regex simples
  const extractMatch = (regex: RegExp) => {
    const match = text.match(regex);
    return match ? match[1].trim() : "N/D";
  };

  const numeroContrato = extractMatch(/contrato\s+numero\s+([a-zA-Z0-9\-\/]+)/i);
  const numeroLicitacion = extractMatch(/licitaci(?:o|ó)n.+?([a-zA-Z0-9\-\/]+)/i);
  let montoDetectado = extractMatch(/\$?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\s*(?:m\.n\.|pesos)/i);

  if (metadata?.monto) montoDetectado = metadata.monto;

  const snippetIndex = Math.max(0, normText.indexOf(hasOfiStore ? "ofi store" : "control de transito") - 50);
  const snippetEvidencia = text.slice(snippetIndex, snippetIndex + 200).replace(/\n/g, " ") + "...";

  return {
    tituloDetectado: metadata?.titulo || url.split("/").pop() || "Documento Desconocido",
    anioDetectado: has2024 ? "2024" : "N/D",
    dependencia: metadata?.dependencia || (normText.includes("fonadin") ? "FONADIN" : "CAPUFE"),
    proveedorDetectado: metadata?.proveedor || (hasOfiStore ? "OFI STORE" : "N/D"),
    tipoDocumento: tipoDocStr,
    numeroContrato: metadata?.numContrato || numeroContrato,
    numeroLicitacion,
    montoDetectado,
    relevanciaScore: score,
    razonesMatch,
    pdfUrl: url,
    sourceUrl,
    snippetEvidencia,
    textoExtraidoPreview: text.substring(0, 500) + "..."
  };
}

async function exportCSV(records: SearchResult[], filePath: string) {
  const headers = [
    "titulo_detectado",
    "anio_detectado",
    "dependencia",
    "proveedor_detectado",
    "tipo_documento",
    "numero_contrato",
    "numero_licitacion",
    "monto_detectado",
    "relevancia_score",
    "pdf_url",
    "source_url",
    "snippet_evidencia",
  ];
  const rows = [headers.join(",")];
  for (const rec of records) {
    const values = headers.map((h) => {
      let val = String(rec[h as keyof SearchResult] || "");
      if (typeof val === "object") val = "Array";
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    });
    rows.push(values.join(","));
  }
  await fs.writeFile(filePath, rows.join("\n"), "utf-8");
}

async function exportPDF(records: SearchResult[], totalFuentes: number, dateStr: string, filePath: string) {
  const html = `
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: sans-serif; padding: 20px; font-size: 13px; }
          h1 { font-size: 18px; color: #333; }
          .summary { margin-bottom: 20px; background: #eee; padding: 15px; border-radius: 5px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
          th, td { border: 1px solid #ccc; padding: 6px; text-align: left; vertical-align: top; }
          th { background-color: #ddd; }
          .evidence { font-style: italic; color: #555; }
        </style>
      </head>
      <body>
        <h1>Búsqueda de contratos 2024 relacionados con CAPUFE/FONADIN</h1>
        <div class="summary">
          <b>Fecha y hora:</b> ${dateStr}<br/>
          <b>Estrategia:</b> Multicapa (SIPOT + Búsqueda Web PDF)<br/>
          <b>Total PDFs revisados:</b> ${totalFuentes}<br/>
          <b>Total hallazgos relevantes:</b> ${records.length}
        </div>
        <table>
          <thead>
            <tr>
              <th>Documento</th>
              <th>Dependencia / Prov.</th>
              <th>Tipo / Num</th>
              <th>Monto</th>
              <th>Enlaces</th>
              <th>Evidencia / Razones</th>
            </tr>
          </thead>
          <tbody>
            ${records.map(r => `
              <tr>
                <td><strong>${r.tituloDetectado}</strong><br/>(${r.anioDetectado})</td>
                <td>${r.dependencia}<br/>${r.proveedorDetectado}</td>
                <td>${r.tipoDocumento}<br/>C: ${r.numeroContrato}<br/>L: ${r.numeroLicitacion}</td>
                <td>${r.montoDetectado}</td>
                <td><a href="${r.pdfUrl}">PDF Directo</a><br/><a href="${r.sourceUrl}">Fuente</a></td>
                <td><div class="evidence">"${r.snippetEvidencia}"</div><br/><strong>Match:</strong> ${r.razonesMatch.join(", ")}</td>
              </tr>
            `).join("")}
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

  const dateStr = new Date().toLocaleString();
  log.info("Iniciando Búsqueda Multicapa CAPUFE/FONADIN 2024...");

  const baseQueries = [
    "OFI STORE CAPUFE 2024 pdf",
    "OFI STORE FONADIN 2024 pdf",
    "mantenimiento preventivo correctivo equipos control de transito peaje telepeaje CAPUFE 2024 pdf",
    "CAPUFE control de transito telepeaje 2024 pdf",
    "FONADIN control de transito telepeaje 2024 pdf",
    "plazas de cobro CAPUFE mantenimiento 2024 pdf",
    "Mexico Puebla telepeaje mantenimiento 2024 pdf",
    "OFI STORE contrato CAPUFE 2024 pdf"
  ];

  const sipotQueries = [
    "OFI STORE",
    "control de transito",
    "telepeaje mexico puebla"
  ];

  let rawCandidates = [];
  const validResults: SearchResult[] = [];
  let pdfsRevisados = 0;

  // CAPA 1: SIPOT
  for (const q of sipotQueries) {
    log.info({ query: q }, "Consultando SIPOT para 2024");
    const records = await querySIPOT(q);
    for (const r of records) {
      if (r.hipervinculoContrato || r.urlContrato) {
         rawCandidates.push({
           url: String(r.hipervinculoContrato || r.urlContrato),
           source: "SIPOT",
           meta: {
             titulo: String(r.objetoContrato || "Contrato"),
             dependencia: String(r.nombreSujetoObligado || ""),
             proveedor: String(r.proveedor || r.contratista || ""),
             anio: "2024",
             monto: String(r.monto || ""),
             numContrato: String(r.numeroContrato || "")
           }
         });
      }
    }
    await sleep(RATE_LIMIT_MS);
  }

  // CAPA 2: Web / DDG
  for (const q of baseQueries) {
    log.info({ query: q }, "Buscando en web / DuckDuckGo");
    const links = await searchDuckDuckGo(q);
    for (const l of links) {
      rawCandidates.push({
        url: l,
        source: "BusquedaWeb",
        meta: {}
      });
    }
    await sleep(RATE_LIMIT_MS);
  }

  // Eliminar duplicados
  const seenUrls = new Set<string>();
  rawCandidates = rawCandidates.filter(c => {
    if (seenUrls.has(c.url)) return false;
    seenUrls.add(c.url);
    return true;
  });

  log.info({ totalCandidates: rawCandidates.length }, "Candidatos únicos encontrados, iniciando extracción y filtrado D...");

  for (const candidate of rawCandidates) {
    // Solo procesar si huele a PDF, o en caso de SIPOT confiar
    if (!candidate.url.toLowerCase().includes(".pdf") && candidate.source !== "SIPOT") continue;
    
    pdfsRevisados++;
    const text = await downloadAndParsePDF(candidate.url);
    if (!text) continue;

    const result = classifyRelevance(text, candidate.url, candidate.source === "SIPOT" ? SIPOT_ENDPOINT_URL : "DuckDuckGo", candidate.meta);
    if (result) {
      log.info({ titulo: result.tituloDetectado, util: true }, "¡Hallazgo Relevante!");
      validResults.push(result);
    }
  }

  const rawJsonPath = path.join(OUTPUT_DIR, "contratos-2024-capufe-busqueda-raw.json");
  await fs.writeFile(rawJsonPath, JSON.stringify(validResults, null, 2), "utf-8");

  const csvPath = path.join(OUTPUT_DIR, "contratos-2024-capufe-resultados.csv");
  await exportCSV(validResults, csvPath);

  const pdfPath = path.join(OUTPUT_DIR, "contratos-2024-capufe-resumen.pdf");
  await exportPDF(validResults, pdfsRevisados, dateStr, pdfPath);

  log.info({ resultados: validResults.length }, "Búsqueda completada, enviados a reportes.");

  // Telegram
  if (validResults.length > 0) {
    const telegramMsg = `🔎 Búsqueda de contratos 2024 completada.\n\n✔️ <b>Total fuentes/PDF revisadas:</b> ${pdfsRevisados}\n🎯 <b>Hallazgos relevantes:</b> ${validResults.length}\n📄 Se adjunta el informe y dataset CSV.`;
    try {
      await sendTelegramMessage(telegramMsg, "HTML");
      await sendTelegramDocument("Reporte Resultados CAPUFE 2024", pdfPath);
      await sendTelegramDocument("Dataset CSV Resultados 2024", csvPath);
      log.info("Reportes enviados exitosamente por Telegram");
    } catch (err) {
      log.error({ err }, "Error enviando a Telegram");
    }
  } else {
    const msg = `🔎 Búsqueda de contratos 2024 completada. No hubo coincidencias relevantes. Se revisaron ${pdfsRevisados} candidatos PDF/fuentes.`;
    log.info(msg);
    try { await sendTelegramMessage(msg, "HTML"); } catch(e){}
  }

  // Display Final Links
  console.log("\n\n==== 🔗 ENLACES PDF RELEVANTES ENCONTRADOS ====\n");
  validResults.forEach((r, idx) => {
    console.log(`[${idx+1}] ${r.pdfUrl}`);
    console.log(`    Razones: ${r.razonesMatch.join(", ")}`);
    console.log(`    Docs: Tipo ${r.tipoDocumento} / Contrato ${r.numeroContrato}\n`);
  });
}

if (require.main === module) {
  main().catch(err => {
    log.error({ err: err instanceof Error ? err.stack : String(err) }, "Error fatal");
    process.exit(1);
  });
}
