import "dotenv/config";
import axios from "axios";
import * as fs from "fs/promises";
import * as path from "path";
import process from "process";
import { chromium } from "playwright";
import * as cheerio from "cheerio";
// @ts-ignore
import pdfParse from "pdf-parse";
import { createModuleLogger } from "../core/logger";
import { sendTelegramDocument, sendTelegramMessage } from "../alerts/telegram.alerts";

const log = createModuleLogger("buscar-operatividad-capufe-2026");

const OUTPUT_DIR = path.join(process.cwd(), "data");
const RATE_LIMIT_MS = 1500;

interface SearchResult {
  categoria: string;
  tituloDetectado: string;
  anioDetectado: string;
  dependencia: string;
  tipoDocumento: string;
  montoDetectado?: string; // Not typically needed for operatividad, but satisfying the interface
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
        if (url.includes("uddg=")) {
          const match = url.match(/uddg=([^&]+)/);
          if (match) results.push(decodeURIComponent(match[1]));
        } else if (url.startsWith("http")) {
          results.push(url);
        }
      }
    });

    return [...new Set(results)];
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
    return null;
  }
}

function classifyRelevance(
  text: string,
  url: string,
  sourceUrl: string
): SearchResult | null {
  const normText = normalizeText(text);

  const keywords = {
    dependencias: ["capufe", "caminos y puentes", "fonadin"],
    anios: ["2026", "2025"], 
    servicios: [
      "mantenimiento",
      "control de transito",
      "telepeaje",
      "peaje",
      "plaza de cobro",
      "caseta"
    ],
    docTypes: [
      "manual", "normativo", "lineamiento", "politica", "procedimiento", "criterio tecnico", "paaas", "adquisicion", "operatividad"
    ]
  };

  let score = 0;
  const razonesMatch: string[] = [];

  const hasDependencia = keywords.dependencias.some((d) => normText.includes(d));
  if (hasDependencia) { score += 20; razonesMatch.push("Contiene dependencia (CAPUFE/FONADIN)"); }
  
  let matchesServicios = 0;
  for (const s of keywords.servicios) {
    if (normText.includes(s)) matchesServicios++;
  }
  if (matchesServicios > 0) {
    score += matchesServicios * 10;
    razonesMatch.push(`Coincide con ${matchesServicios} términos operativos/técnicos`);
  }

  const has2026 = normText.includes("2026") || url.includes("2026");
  const hasVigente = normText.includes("vigente") || normText.includes("2025");
  
  if (has2026) {
    score += 40;
    razonesMatch.push("Mención directa a 2026");
  } else if (hasVigente) {
    score += 15;
    razonesMatch.push("Posible vigencia actual (2025 o 'vigente')");
  }

  let tipoDocStr = "otro";
  for (const t of keywords.docTypes) {
    if (normText.includes(t) || url.toLowerCase().includes(t)) {
      tipoDocStr = t;
      score += 20;
      razonesMatch.push(`Tipo documental detectado: ${t}`);
      break;
    }
  }

  // REGLA DURA: Solo aceptar si aborda operatividad/normativa + dependencia + servicio
  // No aceptar si se trata de un contrato/fallo específico de 2024 (a menos que cruce normativa)
  if (normText.includes("fallo") && normText.includes("2024") && !has2026) {
    // Si es un documento exclusivo de Licitación 2024, sacarlo de aquí.
    return null;
  }

  const isRelevant = 
    (hasDependencia && matchesServicios >= 1 && (tipoDocStr !== "otro") && (has2026 || hasVigente)) ||
    (score >= 60);

  if (!isRelevant) return null;

  const urlLower = url.toLowerCase();
  const indexKey = normText.indexOf("telepeaje") > -1 ? "telepeaje" : "capufe";
  const snippetIndex = Math.max(0, normText.indexOf(indexKey) - 50);
  const snippetEvidencia = text.slice(snippetIndex, snippetIndex + 250).replace(/\n/g, " ") + "...";

  return {
    categoria: "OPERATIVIDAD_2026",
    tituloDetectado: url.split("/").pop() || "Documento Operativo",
    anioDetectado: has2026 ? "2026" : "Vigente",
    dependencia: normText.includes("fonadin") ? "FONADIN" : "CAPUFE",
    tipoDocumento: tipoDocStr.toUpperCase(),
    relevanciaScore: score,
    razonesMatch,
    pdfUrl: url,
    sourceUrl,
    snippetEvidencia,
    textoExtraidoPreview: text.substring(0, 400) + "..."
  };
}

async function exportCSV(records: SearchResult[], filePath: string) {
  const headers = [
    "categoria",
    "titulo_detectado",
    "anio_detectado",
    "dependencia",
    "tipo_documento",
    "pdf_url",
    "source_url",
    "relevancia_score",
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
        <h1>Documentos de operatividad CAPUFE útiles para competir en 2026</h1>
        <div class="summary">
          <b>Fecha y hora:</b> ${dateStr}<br/>
          <b>Estrategia:</b> Búsqueda Normativa/Operativa<br/>
          <b>Total PDFs revisados:</b> ${totalFuentes}<br/>
          <b>Total hallazgos relevantes:</b> ${records.length}
        </div>
        <table>
          <thead>
            <tr>
              <th>Documento</th>
              <th>Dependencia</th>
              <th>Tipo</th>
              <th>Score</th>
              <th>Enlaces</th>
              <th>Evidencia / Razones</th>
            </tr>
          </thead>
          <tbody>
            ${records.map(r => `
              <tr>
                <td><strong>${r.tituloDetectado}</strong><br/>(${r.anioDetectado})</td>
                <td>${r.dependencia}</td>
                <td>${r.tipoDocumento}</td>
                <td>${r.relevanciaScore}</td>
                <td><a href="${r.pdfUrl}">PDF Directo</a></td>
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
  log.info("Iniciando Búsqueda OPERATIVIDAD CAPUFE 2026...");

  const queries = [
    "CAPUFE 2026 pdf telepeaje",
    "CAPUFE 2026 mantenimiento plazas de cobro pdf",
    "CAPUFE 2026 control de transito peaje pdf",
    "CAPUFE 2026 manual telepeaje pdf",
    "CAPUFE 2026 lineamientos plazas de cobro pdf",
    "CAPUFE 2026 normativo peaje pdf",
    "CAPUFE 2026 procedimientos telepeaje pdf",
    "FONADIN CAPUFE 2026 telepeaje pdf",
    "CAPUFE PAAAS 2026 pdf",
    "CAPUFE adquisiciones 2026 pdf",
    "CAPUFE politicas adquisiciones 2026 pdf"
  ];

  let rawCandidates = [];
  const validResults: SearchResult[] = [];
  let pdfsRevisados = 0;

  for (const q of queries) {
    log.info({ query: q }, "Buscando OPERATIVIDAD en web / DuckDuckGo");
    const links = await searchDuckDuckGo(q);
    for (const l of links) {
      rawCandidates.push({ url: l, source: "DuckDuckGo" });
    }
    await sleep(RATE_LIMIT_MS);
  }

  const seenUrls = new Set<string>();
  rawCandidates = rawCandidates.filter(c => {
    if (seenUrls.has(c.url)) return false;
    seenUrls.add(c.url);
    return true;
  });

  log.info({ totalCandidates: rawCandidates.length }, "Candidatos únicos, validando contenidos Duros...");

  for (const candidate of rawCandidates) {
    if (!candidate.url.toLowerCase().includes(".pdf")) continue;
    
    pdfsRevisados++;
    const text = await downloadAndParsePDF(candidate.url);
    if (!text) continue;

    const result = classifyRelevance(text, candidate.url, "DuckDuckGo");
    if (result) {
      log.info({ titulo: result.tituloDetectado }, "Hallazgo OPERATIVIDAD 2026 Valido");
      validResults.push(result);
    }
  }

  const rawJsonPath = path.join(OUTPUT_DIR, "operatividad-capufe-2026-raw.json");
  await fs.writeFile(rawJsonPath, JSON.stringify(validResults, null, 2), "utf-8");

  const csvPath = path.join(OUTPUT_DIR, "operatividad-capufe-2026.csv");
  await exportCSV(validResults, csvPath);

  const pdfPath = path.join(OUTPUT_DIR, "operatividad-capufe-2026-resumen.pdf");
  await exportPDF(validResults, pdfsRevisados, dateStr, pdfPath);

  log.info({ resultados: validResults.length }, "Búsqueda de operatividad completada.");

  if (validResults.length > 0) {
    const telegramMsg = `🔎 Búsqueda OPERATIVIDAD CAPUFE 2026 completada.\n✔️ PDFs revisados: ${pdfsRevisados}\n🎯 Hallazgos útiles: ${validResults.length}`;
    try {
      await sendTelegramMessage(telegramMsg, "HTML");
      await sendTelegramDocument("Resumen Operatividad 2026", pdfPath);
    } catch (err) {}
  }
}

if (require.main === module) {
  main().catch(err => {
    log.error({ err: err instanceof Error ? err.stack : String(err) }, "Error fatal");
    process.exit(1);
  });
}
