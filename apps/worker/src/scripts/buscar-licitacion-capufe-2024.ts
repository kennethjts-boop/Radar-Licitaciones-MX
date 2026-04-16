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

const log = createModuleLogger("buscar-licitacion-capufe-2024");

const OUTPUT_DIR = path.join(process.cwd(), "data");
const RATE_LIMIT_MS = 1500;

interface SearchResult {
  categoria: string;
  tituloDetectado: string;
  anioDetectado: string;
  dependencia: string;
  proveedorDetectado: string;
  numeroContrato: string;
  numeroLicitacion: string;
  tipoDocumento: string;
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
    proveedor: "ofi store",
    dependencias: ["capufe", "caminos y puentes", "fonadin"],
    anios: ["2024"],
    servicios: [
      "mantenimiento",
      "preventivo",
      "correctivo",
      "control de transito",
      "telepeaje",
      "plaza de cobro"
    ],
    docTypes: [
      { id: "CONTRATO_2024", terms: ["contrato"] },
      { id: "FALLO_2024", terms: ["fallo"] },
      { id: "CONVOCATORIA_2024", terms: ["convocatoria", "bases", "junta de aclaraciones"] },
      { id: "ANEXO_TECNICO_2024", terms: ["anexo tecnico"] },
      { id: "PAAAS_REFERENCIAL_2024", terms: ["paaas"] },
      { id: "LICITACION_2024", terms: ["licitacion", "adjudicacion", "propuesta tecnica"] }
    ],
    normativosFlags: ["manual", "lineamiento", "normativo", "procedimiento", "politica"]
  };

  let score = 0;
  const razonesMatch: string[] = [];

  const hasDependencia = keywords.dependencias.some((d) => normText.includes(d));
  const hasOfiStore = normText.includes(keywords.proveedor);
  
  if (hasDependencia) { score += 10; razonesMatch.push("Contiene dependencia (CAPUFE/FONADIN)"); }
  if (hasOfiStore) { score += 50; razonesMatch.push("Contiene OFI STORE"); }
  
  let matchesServicios = 0;
  for (const s of keywords.servicios) {
    if (normText.includes(s)) matchesServicios++;
  }
  
  // Coincidencia casi exacta del objeto principal:
  const objExact = "mantenimiento preventivo y correctivo a equipos de control de transito de peaje y telepeaje";
  if (normText.includes(objExact)) {
    score += 100;
    razonesMatch.push("Coincidencia EXACTA del objeto del servicio");
  } else if (matchesServicios >= 4) {
    score += matchesServicios * 10;
    razonesMatch.push(`Fuerte correlación de servicio (${matchesServicios} términos)`);
  }

  const has2024 = keywords.anios.some(a => normText.includes(a) || url.includes("2024"));
  if (has2024) {
    score += 20;
    razonesMatch.push("Es de 2024");
  }

  // Detect Type
  let detectedType = "NO_RELEVANTE";
  for (const t of keywords.docTypes) {
    if (t.terms.some(term => normText.includes(term))) {
      detectedType = t.id;
      score += 10;
      razonesMatch.push(`Detectado tipo: ${t.id}`);
      break;
    }
  }

  // REGLAS DURAS
  // 1. Debe ser de 2024
  if (!has2024) return null;
  // 2. Debe referenciar compra/contratación, eliminar manuales (basura normativa)
  const isNormative = keywords.normativosFlags.some(n => normText.includes(n)) && detectedType === "NO_RELEVANTE";
  if (isNormative) return null;

  // 3. Relevancia: debe ser muy específico al servicio contratado o a OFI STORE
  const isRelevant = (hasOfiStore && has2024) || (matchesServicios >= 3 && has2024 && detectedType !== "NO_RELEVANTE");

  if (!isRelevant) return null;

  // Extraer
  const extractMatch = (regex: RegExp) => {
    const match = text.match(regex);
    return match ? match[1].trim() : "N/D";
  };
  const numeroContrato = extractMatch(/contrato\s*(?:numero|no\.?|número)?\s*([a-zA-Z0-9\-\/]{6,20})/i);
  const numeroLicitacion = extractMatch(/licitaci(?:o|ó)n\s*(?:p[úu]blica\s*)?(?:nacional\s*)?(?:internacional\s*)?(?:numero|no\.?|número)?\s*([a-zA-Z0-9\-\/]{8,30})/i);
  const montoDetectado = extractMatch(/\$?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\s*(?:m\.n\.|pesos)/i);

  const indexKey = hasOfiStore ? "ofi store" : "equipos de control de";
  const snippetIndex = Math.max(0, normText.indexOf(indexKey) - 50);
  const snippetEvidencia = text.slice(snippetIndex, snippetIndex + 250).replace(/\n/g, " ") + "...";

  return {
    categoria: detectedType !== "NO_RELEVANTE" ? detectedType : "LICITACION_2024", // fallback
    tituloDetectado: url.split("/").pop() || "Documento Contratacion",
    anioDetectado: "2024",
    dependencia: normText.includes("fonadin") ? "FONADIN" : "CAPUFE",
    proveedorDetectado: hasOfiStore ? "OFI STORE" : "N/D",
    numeroContrato,
    numeroLicitacion,
    tipoDocumento: detectedType,
    montoDetectado,
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
    "proveedor_detectado",
    "numero_contrato",
    "numero_licitacion",
    "tipo_documento",
    "monto_detectado",
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
        <h1>Documentos de licitación/contratación 2024 — Servicio de mantenimiento preventivo y correctivo a equipos de control de tránsito de peaje y telepeaje de plazas de cobro CAPUFE</h1>
        <div class="summary">
          <b>Fecha y hora:</b> ${dateStr}<br/>
          <b>Estrategia:</b> Búsqueda estricta de adjudicación 2024<br/>
          <b>Total PDFs revisados:</b> ${totalFuentes}<br/>
          <b>Total hallazgos relevantes:</b> ${records.length}
        </div>
        <table>
          <thead>
            <tr>
              <th>Documento / Categoría</th>
              <th>Dependencia / Prov.</th>
              <th>Contrato / Licitación</th>
              <th>Score</th>
              <th>Enlaces</th>
              <th>Evidencia / Razones</th>
            </tr>
          </thead>
          <tbody>
            ${records.map(r => `
              <tr>
                <td><strong>${r.tituloDetectado}</strong><br/>(${r.categoria})</td>
                <td>${r.dependencia}<br/>${r.proveedorDetectado}</td>
                <td>C: ${r.numeroContrato}<br/>L: ${r.numeroLicitacion}</td>
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
  log.info("Iniciando Búsqueda LICITACION/CONTRATACION CAPUFE 2024...");

  const queries = [
    "\"mantenimiento preventivo y correctivo a equipos de control de tránsito de peaje y telepeaje de las plazas de cobro correspondientes a la red CAPUFE\" pdf 2024",
    "CAPUFE mantenimiento preventivo correctivo equipos control tránsito peaje telepeaje plazas cobro 2024 pdf",
    "CAPUFE telepeaje control de transito plazas de cobro 2024 fallo pdf",
    "CAPUFE telepeaje control de transito plazas de cobro 2024 convocatoria pdf",
    "CAPUFE telepeaje control de transito plazas de cobro 2024 contrato pdf",
    "OFI STORE CAPUFE 2024 pdf",
    "LA-09-JOU-009JOU001-N-91-2025 antecedentes 2024 pdf",
    "CAPUFE red CAPUFE mantenimiento telepeaje 2024 pdf",
    "CAPUFE control de transito de peaje 2024 pdf",
    "CAPUFE plazas de cobro telepeaje 2024 pdf"
  ];

  let rawCandidates = [];
  const validResults: SearchResult[] = [];
  let pdfsRevisados = 0;

  for (const q of queries) {
    log.info({ query: q }, "Buscando LICITACIONES 2024 web / DuckDuckGo");
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
      log.info({ titulo: result.tituloDetectado }, "Hallazgo LICITACION 2024 Valido");
      validResults.push(result);
    }
  }

  const rawJsonPath = path.join(OUTPUT_DIR, "licitacion-capufe-2024-raw.json");
  await fs.writeFile(rawJsonPath, JSON.stringify(validResults, null, 2), "utf-8");

  const csvPath = path.join(OUTPUT_DIR, "licitacion-capufe-2024.csv");
  await exportCSV(validResults, csvPath);

  const pdfPath = path.join(OUTPUT_DIR, "licitacion-capufe-2024-resumen.pdf");
  await exportPDF(validResults, pdfsRevisados, dateStr, pdfPath);

  log.info({ resultados: validResults.length }, "Búsqueda de licitacion completada.");

  if (validResults.length > 0) {
    const telegramMsg = `🔎 Búsqueda LICITACIÓN/CONTRATOS CAPUFE 2024 completada.\n✔️ PDFs revisados: ${pdfsRevisados}\n🎯 Hallazgos útiles: ${validResults.length}`;
    try {
      await sendTelegramMessage(telegramMsg, "HTML");
      await sendTelegramDocument("Resumen Licitaciones 2024", pdfPath);
    } catch (err) {}
  }
}

if (require.main === module) {
  main().catch(err => {
    log.error({ err: err instanceof Error ? err.stack : String(err) }, "Error fatal");
    process.exit(1);
  });
}
