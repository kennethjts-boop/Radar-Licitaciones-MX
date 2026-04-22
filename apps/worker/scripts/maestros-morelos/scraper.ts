import axios from "axios";
import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";
import PDFDocument from "pdfkit";
import { getSupabaseClient } from "../../src/storage/client";

interface EscuelaBase {
  cct: string;
  nombreEscuela: string;
  municipio: string;
  localidad: string;
  direccionEscuela: string;
  telefonoEscuela: string;
  director: string;
}

interface EscuelaDirectorio {
  emailInstitucional: string;
  zonaEscolar: string;
  supervisorZona: string;
}

interface MaestroRegistro {
  nombre: string;
  cct: string;
  escuela: string;
  municipio: string;
  localidad: string;
  direccion_escuela: string;
  telefono_escuela: string;
  email_institucional: string;
  zona_escolar: string;
  supervisor_zona: string;
  funcion: string;
  horas_asignadas: number;
  antiguedad: string;
  menciones_publicas: string[];
  fuentes_consultadas: string[];
}

interface ProgressState {
  processedCcts: number;
  maestros: MaestroRegistro[];
  failedSources: string[];
  escuelasSinDirector: EscuelaBase[];
}

const SEP_DATOS_URL = "https://datos.sep.gob.mx";
const SEP_DIRECTORIO_URL = "https://directorio.sep.gob.mx";
const IEBEM_TRANSPARENCIA_URL = "https://transparencia.iebem.edu.mx";
const SAIMEX_URL = "https://www.saimex.org.mx";
const OUT_XLSX = path.resolve(process.cwd(), "maestros-morelos.xlsx");
const OUT_PDF = path.resolve(process.cwd(), "maestros-morelos.pdf");
const PROGRESS_TABLE = "scrape_maestros_progress";
const SAVE_EVERY = 50;
const RUN_ID = `maestros-morelos-${new Date().toISOString()}`;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";

function sanitize(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function toNumber(value: string): number {
  const n = Number((value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function safeGet(url: string, sourceName: string, failedSources: Set<string>): Promise<string | null> {
  try {
    const res = await axios.get<string>(url, { timeout: 25_000, responseType: "text" });
    return res.data;
  } catch {
    failedSources.add(sourceName);
    return null;
  }
}

async function scrapeEscuelasTelesecundariaMorelos(failedSources: Set<string>): Promise<EscuelaBase[]> {
  const html = await safeGet(`${SEP_DATOS_URL}/catalogo/centros-trabajo?nivel=telesecundaria&estado=morelos`, "datos.sep.gob.mx", failedSources);
  if (!html) return [];

  const $ = cheerio.load(html);
  const rows: EscuelaBase[] = [];

  $("table tbody tr").each((_, tr) => {
    const cells = $(tr).find("td").toArray().map((td) => sanitize($(td).text()));
    if (cells.length < 4) return;

    const cct = sanitize(cells[0]);
    if (!cct || !/^\w{5,}$/.test(cct)) return;

    rows.push({
      cct,
      nombreEscuela: sanitize(cells[1]) || "N/D",
      municipio: sanitize(cells[2]) || "N/D",
      localidad: sanitize(cells[3]) || "N/D",
      direccionEscuela: sanitize(cells[4]) || "N/D",
      telefonoEscuela: sanitize(cells[5]) || "N/D",
      director: sanitize(cells[6]) || "N/D",
    });
  });

  return rows;
}

async function scrapeDirectorioPorCct(cct: string, failedSources: Set<string>): Promise<EscuelaDirectorio> {
  const html = await safeGet(`${SEP_DIRECTORIO_URL}/busqueda?cct=${encodeURIComponent(cct)}`, "directorio.sep.gob.mx", failedSources);
  if (!html) {
    return { emailInstitucional: "N/D", zonaEscolar: "N/D", supervisorZona: "N/D" };
  }

  const $ = cheerio.load(html);
  const pageText = sanitize($.text());

  const emailMatch = pageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const zonaMatch = pageText.match(/zona\s+escolar[:\s]+([^\n]+)/i);
  const supervisorMatch = pageText.match(/supervisor(?:a)?\s+(?:de\s+zona)?[:\s]+([^\n]+)/i);

  return {
    emailInstitucional: sanitize(emailMatch?.[0]) || "N/D",
    zonaEscolar: sanitize(zonaMatch?.[1]) || "N/D",
    supervisorZona: sanitize(supervisorMatch?.[1]) || "N/D",
  };
}

async function scrapePlantillaDocentePorCct(cct: string, escuela: EscuelaBase, failedSources: Set<string>): Promise<MaestroRegistro[]> {
  const fallbackRows: MaestroRegistro[] = [];

  try {
    const puppeteerModule = await import("puppeteer");
    const browser = await puppeteerModule.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.goto(`${IEBEM_TRANSPARENCIA_URL}/plantillas?cct=${encodeURIComponent(cct)}`, { waitUntil: "networkidle2", timeout: 45_000 });

    const scraped = await page.evaluate(() => {
      const out: Array<{ nombre: string; funcion: string; horas: string; antiguedad: string }> = [];
      const rows = Array.from(document.querySelectorAll("table tbody tr"));
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("td")).map((td) => (td.textContent ?? "").trim());
        if (cells.length < 2) continue;
        out.push({
          nombre: cells[0] ?? "",
          funcion: cells[1] ?? "Docente",
          horas: cells[2] ?? "0",
          antiguedad: cells[3] ?? "N/D",
        });
      }
      return out;
    });

    await browser.close();

    if (scraped.length === 0) {
      fallbackRows.push({
        nombre: "Sin plantilla publicada",
        cct,
        escuela: escuela.nombreEscuela,
        municipio: escuela.municipio,
        localidad: escuela.localidad,
        direccion_escuela: escuela.direccionEscuela,
        telefono_escuela: escuela.telefonoEscuela,
        email_institucional: "N/D",
        zona_escolar: "N/D",
        supervisor_zona: "N/D",
        funcion: "N/D",
        horas_asignadas: 0,
        antiguedad: "N/D",
        menciones_publicas: [],
        fuentes_consultadas: ["transparencia.iebem.edu.mx"],
      });
      return fallbackRows;
    }

    return scraped.map((r) => ({
      nombre: sanitize(r.nombre) || "N/D",
      cct,
      escuela: escuela.nombreEscuela,
      municipio: escuela.municipio,
      localidad: escuela.localidad,
      direccion_escuela: escuela.direccionEscuela,
      telefono_escuela: escuela.telefonoEscuela,
      email_institucional: "N/D",
      zona_escolar: "N/D",
      supervisor_zona: "N/D",
      funcion: sanitize(r.funcion) || "Docente",
      horas_asignadas: toNumber(r.horas),
      antiguedad: sanitize(r.antiguedad) || "N/D",
      menciones_publicas: [],
      fuentes_consultadas: ["transparencia.iebem.edu.mx"],
    }));
  } catch {
    failedSources.add("transparencia.iebem.edu.mx");
    return fallbackRows;
  }
}

async function scrapeRespuestasPublicasSaimex(cct: string, failedSources: Set<string>): Promise<string[]> {
  const html = await safeGet(`${SAIMEX_URL}/busqueda?texto=${encodeURIComponent(`telesecundaria ${cct}`)}`, "SAIMEX/INAI", failedSources);
  if (!html) return [];

  const $ = cheerio.load(html);
  const mentions: string[] = [];

  $("a, p, li").each((_, el) => {
    const text = sanitize($(el).text());
    if (/telesecundaria|plantilla|docente/i.test(text) && text.length > 20) {
      mentions.push(text);
    }
  });

  return Array.from(new Set(mentions)).slice(0, 5);
}

async function googleMentions(nombre: string, escuela: string, failedSources: Set<string>): Promise<string[]> {
  const query = `${nombre} ${escuela} Morelos`;
  const html = await safeGet(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=es`, "Google Search", failedSources);
  if (!html) return [];

  const $ = cheerio.load(html);
  const links: string[] = [];
  $("a").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/^\/url\?q=([^&]+)/);
    if (!m) return;
    const url = decodeURIComponent(m[1]);
    if (/elregional\.com\.mx|launion\.com\.mx|diariodemorelos\.com|gob\.mx|morelos\.gob\.mx|cabildo/i.test(url)) {
      links.push(url);
    }
  });

  return Array.from(new Set(links)).slice(0, 5);
}

async function saveProgress(state: ProgressState): Promise<void> {
  try {
    const db = getSupabaseClient();
    await db.from(PROGRESS_TABLE).upsert(
      {
        run_id: RUN_ID,
        processed_ccts: state.processedCcts,
        maestros_json: state.maestros,
        failed_sources: state.failedSources,
        escuelas_sin_director_json: state.escuelasSinDirector,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "run_id" },
    );
  } catch {
    // No-op: tolerancia a fallos de persistencia.
  }
}

async function loadProgress(): Promise<ProgressState> {
  try {
    const db = getSupabaseClient();
    const { data } = await db
      .from(PROGRESS_TABLE)
      .select("processed_ccts, maestros_json, failed_sources, escuelas_sin_director_json")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) {
      return { processedCcts: 0, maestros: [], failedSources: [], escuelasSinDirector: [] };
    }

    return {
      processedCcts: Number(data.processed_ccts ?? 0),
      maestros: Array.isArray(data.maestros_json) ? (data.maestros_json as MaestroRegistro[]) : [],
      failedSources: Array.isArray(data.failed_sources) ? (data.failed_sources as string[]) : [],
      escuelasSinDirector: Array.isArray(data.escuelas_sin_director_json)
        ? (data.escuelas_sin_director_json as EscuelaBase[])
        : [],
    };
  } catch {
    return { processedCcts: 0, maestros: [], failedSources: [], escuelasSinDirector: [] };
  }
}

function enrichMaestros(
  maestros: MaestroRegistro[],
  dirInfo: EscuelaDirectorio,
  saimexMentions: string[],
): MaestroRegistro[] {
  return maestros.map((m) => ({
    ...m,
    email_institucional: dirInfo.emailInstitucional,
    zona_escolar: dirInfo.zonaEscolar,
    supervisor_zona: dirInfo.supervisorZona,
    menciones_publicas: Array.from(new Set([...m.menciones_publicas, ...saimexMentions])),
    fuentes_consultadas: Array.from(new Set([...m.fuentes_consultadas, "directorio.sep.gob.mx", "SAIMEX/INAI"])),
  }));
}

function buildExcel(maestros: MaestroRegistro[], escuelasSinDirector: EscuelaBase[]): void {
  const wb = XLSX.utils.book_new();

  const sheet1 = XLSX.utils.json_to_sheet(maestros.map((m) => ({
    nombre: m.nombre,
    cct: m.cct,
    escuela: m.escuela,
    municipio: m.municipio,
    localidad: m.localidad,
    direccion_escuela: m.direccion_escuela,
    telefono_escuela: m.telefono_escuela,
    email_institucional: m.email_institucional,
    zona_escolar: m.zona_escolar,
    supervisor_zona: m.supervisor_zona,
    funcion: m.funcion,
    horas_asignadas: m.horas_asignadas,
    antiguedad: m.antiguedad,
    menciones_publicas: m.menciones_publicas.join(" | "),
    fuentes_consultadas: m.fuentes_consultadas.join(" | "),
  })));

  const resumenMunicipioMap = new Map<string, { municipio: string; maestros: number; escuelas: Set<string> }>();
  for (const m of maestros) {
    const current = resumenMunicipioMap.get(m.municipio) ?? { municipio: m.municipio, maestros: 0, escuelas: new Set<string>() };
    current.maestros += 1;
    current.escuelas.add(m.escuela);
    resumenMunicipioMap.set(m.municipio, current);
  }
  const resumenRows = Array.from(resumenMunicipioMap.values()).map((r) => ({ municipio: r.municipio, maestros: r.maestros, escuelas: r.escuelas.size }));
  const sheet2 = XLSX.utils.json_to_sheet(resumenRows);

  const sheet3 = XLSX.utils.json_to_sheet(escuelasSinDirector.map((e) => ({
    cct: e.cct,
    escuela: e.nombreEscuela,
    municipio: e.municipio,
    localidad: e.localidad,
    direccion: e.direccionEscuela,
    telefono: e.telefonoEscuela,
    director: e.director,
  })));

  XLSX.utils.book_append_sheet(wb, sheet1, "maestros");
  XLSX.utils.book_append_sheet(wb, sheet2, "resumen_municipio");
  XLSX.utils.book_append_sheet(wb, sheet3, "escuelas_sin_director");
  XLSX.writeFile(wb, OUT_XLSX);
}

async function buildPdf(maestros: MaestroRegistro[]): Promise<void> {
  const municipios = Array.from(new Set(maestros.map((m) => m.municipio))).sort();
  const bySchool = new Map<string, MaestroRegistro[]>();
  for (const m of maestros) {
    const key = `${m.municipio}||${m.escuela}`;
    const arr = bySchool.get(key) ?? [];
    arr.push(m);
    bySchool.set(key, arr);
  }

  const doc = new PDFDocument({ margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

  doc.fontSize(18).text("Directorio Docente Telesecundaria Morelos 2026", { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Generado: ${new Date().toISOString()}`);

  doc.addPage();
  doc.fontSize(14).text("Índice por municipio");
  doc.moveDown(0.5);
  municipios.forEach((m, idx) => doc.fontSize(11).text(`${idx + 1}. ${m}`));

  for (const [key, teachers] of bySchool.entries()) {
    const [municipio, escuela] = key.split("||");
    const first = teachers[0];

    doc.addPage();
    doc.fontSize(13).text(`Municipio: ${municipio}`);
    doc.fontSize(13).text(`Escuela: ${escuela}`);
    doc.fontSize(11).text(`Dirección: ${first.direccion_escuela}`);
    doc.fontSize(11).text(`Teléfono: ${first.telefono_escuela}`);
    doc.moveDown(0.5);

    for (const t of teachers) {
      doc.fontSize(11).text(`Docente: ${t.nombre}`);
      doc.text(`CCT: ${t.cct} | Función: ${t.funcion} | Horas: ${t.horas_asignadas} | Antigüedad: ${t.antiguedad}`);
      doc.text(`Email: ${t.email_institucional} | Zona: ${t.zona_escolar} | Supervisor: ${t.supervisor_zona}`);
      doc.text(`Menciones públicas: ${t.menciones_publicas.join(" | ") || "N/D"}`);
      doc.text(`Fuentes: ${t.fuentes_consultadas.join(" | ")}`);
      doc.moveDown(0.5);
    }
  }

  doc.addPage();
  doc.fontSize(12).text("Fuentes consultadas");
  ["datos.sep.gob.mx", "directorio.sep.gob.mx", "transparencia.iebem.edu.mx", "SAIMEX/INAI", "Google Search"]
    .forEach((s) => doc.text(`- ${s}`));

  doc.end();

  await new Promise<void>((resolve, reject) => {
    doc.on("end", async () => {
      try {
        await fs.writeFile(OUT_PDF, Buffer.concat(chunks));
        resolve();
      } catch (err) {
        reject(err);
      }
    });
    doc.on("error", reject);
  });
}

async function sendTelegramMessage(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    chat_id: TELEGRAM_CHAT_ID,
    text,
  }, { timeout: 20_000 });
}

async function sendTelegramDocument(filePath: string, caption: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const fileBuffer = await fs.readFile(filePath);
  const form = new FormData();
  form.append("chat_id", TELEGRAM_CHAT_ID);
  form.append("caption", caption);
  form.append("document", new Blob([fileBuffer]), path.basename(filePath));

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form,
  });
}

async function run(): Promise<void> {
  const failedSources = new Set<string>();
  const progress = await loadProgress();
  progress.failedSources.forEach((f) => failedSources.add(f));

  const escuelas = await scrapeEscuelasTelesecundariaMorelos(failedSources);
  if (escuelas.length === 0) {
    await sendTelegramMessage("⚠️ Scraper maestros: no se pudieron recuperar escuelas de telesecundaria Morelos.");
    return;
  }

  const escuelasSinDirector = [...progress.escuelasSinDirector];
  const maestros = [...progress.maestros];

  for (let idx = progress.processedCcts; idx < escuelas.length; idx++) {
    const escuela = escuelas[idx];

    if (!sanitize(escuela.director) || /n\/d|sin|pendiente/i.test(escuela.director)) {
      escuelasSinDirector.push(escuela);
    }

    const dirInfo = await scrapeDirectorioPorCct(escuela.cct, failedSources);
    const plantilla = await scrapePlantillaDocentePorCct(escuela.cct, escuela, failedSources);
    const saimexMentions = await scrapeRespuestasPublicasSaimex(escuela.cct, failedSources);

    const enriched = enrichMaestros(plantilla, dirInfo, saimexMentions);

    for (const maestro of enriched) {
      if (maestro.nombre === "Sin plantilla publicada") continue;
      const mentions = await googleMentions(maestro.nombre, maestro.escuela, failedSources);
      maestro.menciones_publicas = Array.from(new Set([...maestro.menciones_publicas, ...mentions]));
      maestro.fuentes_consultadas = Array.from(new Set([...maestro.fuentes_consultadas, "Google Search"]));
      maestros.push(maestro);
    }

    if ((idx + 1) % SAVE_EVERY === 0) {
      await saveProgress({
        processedCcts: idx + 1,
        maestros,
        failedSources: Array.from(failedSources),
        escuelasSinDirector,
      });
    }
  }

  await saveProgress({
    processedCcts: escuelas.length,
    maestros,
    failedSources: Array.from(failedSources),
    escuelasSinDirector,
  });

  buildExcel(maestros, escuelasSinDirector);
  await buildPdf(maestros);

  const municipios = new Set(maestros.map((m) => m.municipio));
  const escuelasUnicas = new Set(maestros.map((m) => m.cct));

  await sendTelegramMessage(
    [
      "✅ Scraping completado",
      `👨‍🏫 Maestros encontrados: ${maestros.length}`,
      `🏫 Escuelas: ${escuelasUnicas.size}`,
      `📍 Municipios: ${municipios.size}`,
      `⚠️ Fuentes que fallaron: ${failedSources.size > 0 ? Array.from(failedSources).join(", ") : "Ninguna"}`,
      "📎 Archivos adjuntos a continuación...",
    ].join("\n"),
  );

  await sendTelegramDocument(OUT_XLSX, "maestros-morelos.xlsx");
  await sendTelegramDocument(OUT_PDF, "maestros-morelos.pdf");
}

run().catch(async (err) => {
  const message = err instanceof Error ? err.message : String(err);
  await sendTelegramMessage(`❌ Scraper maestros falló: ${message}`);
  process.exitCode = 1;
});
