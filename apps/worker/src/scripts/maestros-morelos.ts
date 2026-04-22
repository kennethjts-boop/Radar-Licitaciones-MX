import axios from "axios";
import * as cheerio from "cheerio";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import TelegramBot from "node-telegram-bot-api";
import { getSupabaseClient } from "../storage/client";
import { getLogger } from "../core/logger";

const XLSX: any = require("xlsx");
const PDFDocument = require("pdfkit") as any;

type EscuelaBase = {
  cct: string;
  escuela: string;
  municipio: string;
  localidad: string;
  direccion: string;
  telefono: string;
  director: string;
};

type EscuelaDir = {
  email: string;
  zona: string;
  supervisor: string;
};

export type MaestroRegistro = {
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
};

type ProgressPayload = {
  maestros: MaestroRegistro[];
  escuelasSinDirector: EscuelaBase[];
};

const SEP_DATOS_URL = "https://datos.sep.gob.mx";
const SEP_DIRECTORIO_URL = "https://directorio.sep.gob.mx";
const IEBEM_URL = "https://transparencia.iebem.edu.mx";
const SAIMEX_URL = "https://www.saimex.org.mx";
const PROGRESS_TABLE = "scrape_maestros_progress";
const SAVE_EVERY = 50;

const OUT_XLSX = path.resolve(process.cwd(), "maestros-morelos.xlsx");
const OUT_PDF = path.resolve(process.cwd(), "maestros-morelos.pdf");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";

const log = getLogger().child({ module: "maestros-morelos" });

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toNumber(value: string): number {
  const n = Number(clean(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function safeGet(url: string, source: string, failedSources: Set<string>): Promise<string | null> {
  try {
    const res = await axios.get<string>(url, { responseType: "text", timeout: 30_000 });
    return res.data;
  } catch (err) {
    failedSources.add(source);
    log.warn({ source, err }, "Fallo consultando fuente");
    return null;
  }
}

async function fetchEscuelas(failedSources: Set<string>): Promise<EscuelaBase[]> {
  const html = await safeGet(
    `${SEP_DATOS_URL}/catalogo/centros-trabajo?nivel=telesecundaria&estado=morelos`,
    "datos.sep.gob.mx",
    failedSources,
  );
  if (!html) return [];

  const $ = cheerio.load(html);
  const out: EscuelaBase[] = [];

  $("table tbody tr").each((_, tr) => {
    const tds = $(tr)
      .find("td")
      .toArray()
      .map((td) => clean($(td).text()));

    if (tds.length < 4) return;
    const cct = clean(tds[0]);
    if (!cct) return;

    out.push({
      cct,
      escuela: clean(tds[1]) || "N/D",
      municipio: clean(tds[2]) || "N/D",
      localidad: clean(tds[3]) || "N/D",
      direccion: clean(tds[4]) || "N/D",
      telefono: clean(tds[5]) || "N/D",
      director: clean(tds[6]) || "N/D",
    });
  });

  return out;
}

async function fetchDirectorioByCct(cct: string, failedSources: Set<string>): Promise<EscuelaDir> {
  const html = await safeGet(
    `${SEP_DIRECTORIO_URL}/busqueda?cct=${encodeURIComponent(cct)}`,
    "directorio.sep.gob.mx",
    failedSources,
  );
  if (!html) return { email: "N/D", zona: "N/D", supervisor: "N/D" };

  const $ = cheerio.load(html);
  const text = clean($.root().text());

  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "N/D";
  const zona = text.match(/zona\s+escolar[:\s]+([^\n]+)/i)?.[1] ?? "N/D";
  const supervisor = text.match(/supervisor(?:a)?\s+(?:de\s+zona)?[:\s]+([^\n]+)/i)?.[1] ?? "N/D";

  return { email: clean(email), zona: clean(zona), supervisor: clean(supervisor) };
}

async function fetchPlantillaByCct(cct: string, escuela: EscuelaBase, failedSources: Set<string>): Promise<MaestroRegistro[]> {
  try {
    const puppeteer = require("puppeteer") as any;
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.goto(`${IEBEM_URL}/plantillas?cct=${encodeURIComponent(cct)}`, {
      waitUntil: "networkidle2",
      timeout: 45_000,
    });

    const rows = await page.evaluate(() => {
      const parsed: Array<{ nombre: string; funcion: string; horas: string; antiguedad: string }> = [];
      const d = (globalThis as any).document as any;
      const trNodes = Array.from((d?.querySelectorAll?.("table tbody tr") ?? []) as any[]);
      trNodes.forEach((tr: any) => {
        const cells = Array.from((tr?.querySelectorAll?.("td") ?? []) as any[]).map((td: any) => String(td?.textContent ?? "").trim());
        if (cells.length < 2) return;
        parsed.push({
          nombre: cells[0] ?? "",
          funcion: cells[1] ?? "Docente",
          horas: cells[2] ?? "0",
          antiguedad: cells[3] ?? "N/D",
        });
      });
      return parsed;
    });

    await browser.close();

    return rows.map((r: { nombre: string; funcion: string; horas: string; antiguedad: string }) => ({
      nombre: clean(r.nombre) || "N/D",
      cct,
      escuela: escuela.escuela,
      municipio: escuela.municipio,
      localidad: escuela.localidad,
      direccion_escuela: escuela.direccion,
      telefono_escuela: escuela.telefono,
      email_institucional: "N/D",
      zona_escolar: "N/D",
      supervisor_zona: "N/D",
      funcion: clean(r.funcion) || "Docente",
      horas_asignadas: toNumber(r.horas),
      antiguedad: clean(r.antiguedad) || "N/D",
      menciones_publicas: [],
      fuentes_consultadas: ["transparencia.iebem.edu.mx"],
    }));
  } catch (err) {
    failedSources.add("transparencia.iebem.edu.mx");
    log.warn({ cct, err }, "No se pudo recuperar plantilla IEBEM");
    return [];
  }
}

async function fetchSaimexMentions(cct: string, failedSources: Set<string>): Promise<string[]> {
  const html = await safeGet(
    `${SAIMEX_URL}/busqueda?texto=${encodeURIComponent(`telesecundaria ${cct}`)}`,
    "SAIMEX",
    failedSources,
  );
  if (!html) return [];

  const $ = cheerio.load(html);
  const mentions: string[] = [];
  $("a, p, li").each((_, el) => {
    const t = clean($(el).text());
    if (t.length > 20 && /telesecundaria|plantilla|docente|escuela/i.test(t)) mentions.push(t);
  });

  return Array.from(new Set(mentions)).slice(0, 5);
}

async function fetchGoogleMentions(nombre: string, escuela: string, failedSources: Set<string>): Promise<string[]> {
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
    if (/elregional|launion|diariodemorelos|gob\.mx|morelos\.gob|cabildo/i.test(url)) links.push(url);
  });

  return Array.from(new Set(links)).slice(0, 5);
}

async function saveProgress(cct: string, datos: ProgressPayload): Promise<void> {
  try {
    const db = getSupabaseClient();
    await db.from(PROGRESS_TABLE).insert({ cct, datos });
  } catch (err) {
    log.warn({ err }, "No se pudo guardar progreso en Supabase");
  }
}

async function loadProgress(): Promise<{ cct: string | null; datos: ProgressPayload }> {
  try {
    const db = getSupabaseClient();
    const { data } = await db
      .from(PROGRESS_TABLE)
      .select("cct, datos")
      .order("procesado_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return { cct: null, datos: { maestros: [], escuelasSinDirector: [] } };

    const datos = (data.datos ?? {}) as Partial<ProgressPayload>;
    return {
      cct: clean(data.cct) || null,
      datos: {
        maestros: Array.isArray(datos.maestros) ? datos.maestros : [],
        escuelasSinDirector: Array.isArray(datos.escuelasSinDirector) ? datos.escuelasSinDirector : [],
      },
    };
  } catch (err) {
    log.warn({ err }, "No se pudo leer progreso, iniciando desde cero");
    return { cct: null, datos: { maestros: [], escuelasSinDirector: [] } };
  }
}

function createExcel(maestros: MaestroRegistro[], escuelasSinDirector: EscuelaBase[]): void {
  const wb = XLSX.utils.book_new();
  const maestrosSheet = XLSX.utils.json_to_sheet(maestros);

  const munMap = new Map<string, { municipio: string; maestros: number; escuelas: Set<string> }>();
  for (const m of maestros) {
    const v = munMap.get(m.municipio) ?? { municipio: m.municipio, maestros: 0, escuelas: new Set<string>() };
    v.maestros += 1;
    v.escuelas.add(m.cct);
    munMap.set(m.municipio, v);
  }

  const resumenSheet = XLSX.utils.json_to_sheet(
    Array.from(munMap.values()).map((m) => ({ municipio: m.municipio, maestros: m.maestros, escuelas: m.escuelas.size })),
  );

  const sinDirectorSheet = XLSX.utils.json_to_sheet(escuelasSinDirector.map((e) => ({
    cct: e.cct,
    escuela: e.escuela,
    municipio: e.municipio,
    localidad: e.localidad,
    direccion: e.direccion,
    telefono: e.telefono,
    director: e.director,
  })));

  XLSX.utils.book_append_sheet(wb, maestrosSheet, "maestros");
  XLSX.utils.book_append_sheet(wb, resumenSheet, "resumen_municipio");
  XLSX.utils.book_append_sheet(wb, sinDirectorSheet, "escuelas_sin_director");
  XLSX.writeFile(wb, OUT_XLSX);
}

async function createPdf(maestros: MaestroRegistro[]): Promise<void> {
  const doc = new PDFDocument({ margin: 40 });
  const chunks: Buffer[] = [];

  doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));

  doc.fontSize(20).text("Directorio Docente Telesecundaria Morelos 2026", { align: "center" });
  doc.moveDown();

  const municipios = Array.from(new Set(maestros.map((m) => m.municipio))).sort();

  doc.addPage();
  doc.fontSize(14).text("Índice por municipio");
  municipios.forEach((m, i) => doc.fontSize(11).text(`${i + 1}. ${m}`));

  const bySchool = new Map<string, MaestroRegistro[]>();
  maestros.forEach((m) => {
    const key = `${m.municipio}::${m.cct}::${m.escuela}`;
    bySchool.set(key, [...(bySchool.get(key) ?? []), m]);
  });

  for (const [key, lista] of bySchool.entries()) {
    const [municipio, cct, escuela] = key.split("::");
    const first = lista[0];

    doc.addPage();
    doc.fontSize(13).text(`${escuela} (${cct})`);
    doc.fontSize(11).text(`Municipio: ${municipio}`);
    doc.text(`Dirección: ${first.direccion_escuela}`);
    doc.text(`Teléfono: ${first.telefono_escuela}`);
    doc.moveDown(0.5);

    for (const t of lista) {
      doc.fontSize(11).text(`• ${t.nombre} — ${t.funcion}`);
      doc.text(`  Horas: ${t.horas_asignadas} | Antigüedad: ${t.antiguedad}`);
      doc.text(`  Email: ${t.email_institucional} | Zona: ${t.zona_escolar} | Supervisor: ${t.supervisor_zona}`);
      doc.text(`  Menciones: ${t.menciones_publicas.join(" | ") || "N/D"}`);
    }
  }

  doc.end();

  await new Promise<void>((resolve, reject) => {
    doc.on("end", async () => {
      try {
        await fsp.writeFile(OUT_PDF, Buffer.concat(chunks));
        resolve();
      } catch (err) {
        reject(err);
      }
    });
    doc.on("error", reject);
  });
}

async function sendTelegramSummaryAndFiles(maestros: MaestroRegistro[], failedSources: Set<string>): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    log.warn("TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados; se omite envío");
    return;
  }

  const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
  const escuelas = new Set(maestros.map((m) => m.cct));
  const municipios = new Set(maestros.map((m) => m.municipio));

  await bot.sendMessage(
    TELEGRAM_CHAT_ID,
    [
      "✅ Scraping maestros completado",
      `👨‍🏫 Maestros: ${maestros.length}`,
      `🏫 Escuelas: ${escuelas.size}`,
      `📍 Municipios: ${municipios.size}`,
      `⚠️ Fuentes fallidas: ${failedSources.size > 0 ? Array.from(failedSources).join(", ") : "Ninguna"}`,
    ].join("\n"),
  );

  await bot.sendDocument(TELEGRAM_CHAT_ID, fs.createReadStream(OUT_XLSX), {}, { filename: "maestros-morelos.xlsx" });
  await bot.sendDocument(TELEGRAM_CHAT_ID, fs.createReadStream(OUT_PDF), {}, { filename: "maestros-morelos.pdf" });
}

export async function runMaestrosScraper(): Promise<void> {
  const failedSources = new Set<string>();
  const escuelas = await fetchEscuelas(failedSources);
  if (escuelas.length === 0) {
    throw new Error("No se obtuvieron telesecundarias desde datos.sep.gob.mx");
  }

  const progress = await loadProgress();
  const maestros: MaestroRegistro[] = [...progress.datos.maestros];
  const escuelasSinDirector: EscuelaBase[] = [...progress.datos.escuelasSinDirector];

  let startIndex = 0;
  if (progress.cct) {
    const idx = escuelas.findIndex((e) => e.cct === progress.cct);
    startIndex = idx >= 0 ? idx + 1 : 0;
  }

  for (let i = startIndex; i < escuelas.length; i++) {
    const escuela = escuelas[i];
    const dir = await fetchDirectorioByCct(escuela.cct, failedSources);
    const plantilla = await fetchPlantillaByCct(escuela.cct, escuela, failedSources);
    const saimex = await fetchSaimexMentions(escuela.cct, failedSources);

    if (!escuela.director || /n\/d|sin|pendiente/i.test(escuela.director)) {
      escuelasSinDirector.push(escuela);
    }

    for (const m of plantilla) {
      const google = await fetchGoogleMentions(m.nombre, m.escuela, failedSources);
      maestros.push({
        ...m,
        email_institucional: dir.email,
        zona_escolar: dir.zona,
        supervisor_zona: dir.supervisor,
        menciones_publicas: Array.from(new Set([...saimex, ...google])),
        fuentes_consultadas: [
          "datos.sep.gob.mx",
          "directorio.sep.gob.mx",
          "transparencia.iebem.edu.mx",
          "SAIMEX",
          "Google Search",
        ],
      });
    }

    if ((i + 1) % SAVE_EVERY === 0) {
      await saveProgress(escuela.cct, { maestros, escuelasSinDirector });
    }
  }

  await saveProgress(escuelas[escuelas.length - 1].cct, { maestros, escuelasSinDirector });

  createExcel(maestros, escuelasSinDirector);
  await createPdf(maestros);
  await sendTelegramSummaryAndFiles(maestros, failedSources);

  log.info(
    {
      maestros: maestros.length,
      escuelas: new Set(maestros.map((m) => m.cct)).size,
      municipios: new Set(maestros.map((m) => m.municipio)).size,
      failedSources: Array.from(failedSources),
    },
    "Scraper maestros finalizado",
  );
}
