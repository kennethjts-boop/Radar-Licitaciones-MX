import axios from "axios";
import * as cheerio from "cheerio";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import TelegramBot from "node-telegram-bot-api";
import { getSupabaseClient } from "../storage/client";
import { getLogger } from "../core/logger";

const XLSX: any = require("xlsx");

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

const SEP_DIRECTORIO_URL = "https://www.sistemas.sep.gob.mx/consultaDatosEscola/";
const SEP_ESTADISTICA_URL = "https://dgpp.sep.gob.mx/Estadi/";
const IEBEM_URL = "https://www.iebem.edu.mx/transparencia";
const TRANSPARENCIA_MORELOS_URL = "https://transparencia.morelos.gob.mx";
const SAIMEX_URL = "https://www.saimex.org.mx";
const NOTICIAS_DIARIO_MORELOS_URL = "https://www.diariodemorelos.com";
const NOTICIAS_UNION_MORELOS_URL = "https://uniondemorelos.com";
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
  try {
    const puppeteer = require("puppeteer") as any;
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.goto(SEP_DIRECTORIO_URL, { waitUntil: "networkidle2", timeout: 45_000 });

    const rows = await page.evaluate(() => {
      const out: Array<{
        cct: string; escuela: string; municipio: string; localidad: string; direccion: string; telefono: string; director: string;
      }> = [];
      const d = (globalThis as any).document as any;
      const trs = Array.from((d?.querySelectorAll?.("table tbody tr") ?? []) as any[]);
      trs.forEach((tr: any) => {
        const cells = Array.from((tr?.querySelectorAll?.("td") ?? []) as any[]).map((td: any) => String(td?.textContent ?? "").trim());
        if (cells.length < 3) return;
        const rowText = cells.join(" ").toLowerCase();
        if (!rowText.includes("morelos") || !rowText.includes("telesecundaria")) return;
        out.push({
          cct: cells[0] ?? "",
          escuela: cells[1] ?? "",
          municipio: cells[2] ?? "N/D",
          localidad: cells[3] ?? "N/D",
          direccion: cells[4] ?? "N/D",
          telefono: cells[5] ?? "N/D",
          director: cells[6] ?? "N/D",
        });
      });
      return out;
    });
    await browser.close();

    const normalized = rows
      .map((r: { cct: string; escuela: string; municipio: string; localidad: string; direccion: string; telefono: string; director: string }) => ({
        cct: clean(r.cct),
        escuela: clean(r.escuela),
        municipio: clean(r.municipio) || "N/D",
        localidad: clean(r.localidad) || "N/D",
        direccion: clean(r.direccion) || "N/D",
        telefono: clean(r.telefono) || "N/D",
        director: clean(r.director) || "N/D",
      }))
      .filter((r: { cct: string; escuela: string }) => r.cct.length > 0 && r.escuela.length > 0);

    log.info({ source: "sistemas.sep.gob.mx", escuelas: normalized.length }, "Escuelas recuperadas de Directorio SEP");
    return normalized;
  } catch (err) {
    failedSources.add("sistemas.sep.gob.mx/consultaDatosEscola");
    log.warn({ err }, "Falló fuente 1 Directorio SEP; se continúa con demás fuentes");
    return [];
  }
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
    await page.goto(`${SEP_ESTADISTICA_URL}?q=${encodeURIComponent(`morelos telesecundaria ${cct}`)}`, {
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
      fuentes_consultadas: ["dgpp.sep.gob.mx/Estadi"],
    }));
  } catch (err) {
    failedSources.add("dgpp.sep.gob.mx/Estadi");
    log.warn({ cct, err }, "No se pudo recuperar plantilla en Estadística SEP");
    return [];
  }
}

async function fetchIebemMentions(cct: string, failedSources: Set<string>): Promise<string[]> {
  const html = await safeGet(`${IEBEM_URL}?q=${encodeURIComponent(`plantilla docente ${cct}`)}`, "iebem.edu.mx/transparencia", failedSources);
  if (!html) return [];
  const $ = cheerio.load(html);
  const mentions: string[] = [];
  $("a, p, li").each((_, el) => {
    const t = clean($(el).text());
    if (t.length > 20 && /plantilla|docente|telesecundaria|directorio/i.test(t)) mentions.push(t);
  });
  return Array.from(new Set(mentions)).slice(0, 5);
}

async function fetchTransparenciaMorelosDocs(cct: string, failedSources: Set<string>): Promise<string[]> {
  const html = await safeGet(
    `${TRANSPARENCIA_MORELOS_URL}/busqueda?texto=${encodeURIComponent(`plantilla docente telesecundaria IEBEM ${cct}`)}`,
    "transparencia.morelos.gob.mx",
    failedSources,
  );
  if (!html) return [];
  const $ = cheerio.load(html);
  const docs: string[] = [];
  $("a, p, li").each((_, el) => {
    const txt = clean($(el).text());
    const href = clean($(el).attr("href"));
    if (/plantilla|docente|iebem|telesecundaria/i.test(`${txt} ${href}`) && txt.length > 10) {
      docs.push(`${txt}${href ? ` (${href})` : ""}`);
    }
  });
  return Array.from(new Set(docs)).slice(0, 5);
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

async function fetchNewsMentions(nombre: string, failedSources: Set<string>): Promise<string[]> {
  const mentions: string[] = [];
  const sources = [
    { url: `${NOTICIAS_DIARIO_MORELOS_URL}/search/node/${encodeURIComponent(nombre)}`, label: "diariodemorelos.com" },
    { url: `${NOTICIAS_UNION_MORELOS_URL}/search/node/${encodeURIComponent(nombre)}`, label: "uniondemorelos.com" },
  ];

  for (const src of sources) {
    const html = await safeGet(src.url, src.label, failedSources);
    if (!html) continue;
    const $ = cheerio.load(html);
    $("a, h2, h3").each((_, el) => {
      const txt = clean($(el).text());
      if (txt.length > 12) mentions.push(`${src.label}: ${txt}`);
    });
  }

  return Array.from(new Set(mentions)).slice(0, 5);
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
  const municipios = Array.from(new Set(maestros.map((m) => m.municipio))).sort();
  const bySchool = new Map<string, MaestroRegistro[]>();

  maestros.forEach((m) => {
    const key = `${m.municipio}::${m.cct}::${m.escuela}`;
    bySchool.set(key, [...(bySchool.get(key) ?? []), m]);
  });

  const cards = Array.from(bySchool.entries())
    .map(([key, lista]) => {
      const [municipio, cct, escuela] = key.split("::");
      const first = lista[0];
      const docentes = lista
        .map(
          (t) => `
            <div class="docente">
              <strong>${escapeHtml(t.nombre)}</strong> — ${escapeHtml(t.funcion)}<br/>
              Horas: ${t.horas_asignadas} | Antigüedad: ${escapeHtml(t.antiguedad)}<br/>
              Email: ${escapeHtml(t.email_institucional)} | Zona: ${escapeHtml(t.zona_escolar)} | Supervisor: ${escapeHtml(t.supervisor_zona)}<br/>
              Menciones: ${escapeHtml(t.menciones_publicas.join(" | ") || "N/D")}
            </div>
          `,
        )
        .join("\n");

      return `
        <section class="escuela">
          <h3>${escapeHtml(escuela)} (${escapeHtml(cct)})</h3>
          <p><b>Municipio:</b> ${escapeHtml(municipio)}</p>
          <p><b>Dirección:</b> ${escapeHtml(first.direccion_escuela)}</p>
          <p><b>Teléfono:</b> ${escapeHtml(first.telefono_escuela)}</p>
          ${docentes}
        </section>
      `;
    })
    .join("\n");

  const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; color: #111; font-size: 12px; }
          h1 { text-align: center; margin-bottom: 8px; }
          h2 { margin-top: 24px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
          h3 { margin-bottom: 4px; }
          .index li { margin: 2px 0; }
          .escuela { page-break-inside: avoid; margin-bottom: 20px; border: 1px solid #ddd; padding: 10px; border-radius: 6px; }
          .docente { margin-top: 8px; padding-top: 6px; border-top: 1px dashed #ccc; }
        </style>
      </head>
      <body>
        <h1>Directorio Docente Telesecundaria Morelos 2026</h1>
        <p>Generado: ${new Date().toISOString()}</p>

        <h2>Índice por municipio</h2>
        <ul class="index">
          ${municipios.map((m) => `<li>${escapeHtml(m)}</li>`).join("\n")}
        </ul>

        <h2>Detalle por escuela y docente</h2>
        ${cards}
      </body>
    </html>
  `;

  const puppeteer = require("puppeteer") as any;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.pdf({ path: OUT_PDF, format: "A4", printBackground: true, margin: { top: "18mm", right: "12mm", bottom: "18mm", left: "12mm" } });
  await browser.close();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function sendTelegramSummaryAndFiles(maestros: MaestroRegistro[], failedSources: Set<string>): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    log.warn("TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados; se omite envío");
    return;
  }

  try {
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

    if (fs.existsSync(OUT_XLSX)) {
      await bot.sendDocument(TELEGRAM_CHAT_ID, fs.createReadStream(OUT_XLSX), {}, { filename: "maestros-morelos.xlsx" });
    }

    if (fs.existsSync(OUT_PDF)) {
      await bot.sendDocument(TELEGRAM_CHAT_ID, fs.createReadStream(OUT_PDF), {}, { filename: "maestros-morelos.pdf" });
    }
  } catch (err) {
    log.error({ err }, "No se pudo enviar resumen/adjuntos a Telegram");
  }
}

async function sendNoDataMessage(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    log.warn("TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados; no se puede enviar mensaje sin datos");
    return;
  }
  try {
    const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
    await bot.sendMessage(TELEGRAM_CHAT_ID, "⚠️ Scraper completado sin datos — todas las fuentes fallaron");
  } catch (err) {
    log.error({ err }, "No se pudo enviar mensaje de scraper sin datos");
  }
}

export async function runMaestrosScraper(): Promise<void> {
  const failedSources = new Set<string>();
  try {
    const escuelas = await fetchEscuelas(failedSources);

    const progress = await loadProgress();
    const maestros: MaestroRegistro[] = [...progress.datos.maestros];
    const escuelasSinDirector: EscuelaBase[] = [...progress.datos.escuelasSinDirector];

    if (escuelas.length === 0) {
      log.warn("No se obtuvieron escuelas desde fuentes SEP; continuando con demás fuentes y cierre controlado");
      await sendTelegramSummaryAndFiles(maestros, failedSources);
      return;
    }

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
      const iebemMentions = await fetchIebemMentions(escuela.cct, failedSources);
      const morelosDocs = await fetchTransparenciaMorelosDocs(escuela.cct, failedSources);

      if (!escuela.director || /n\/d|sin|pendiente/i.test(escuela.director)) {
        escuelasSinDirector.push(escuela);
      }

      for (const m of plantilla) {
        const newsMentions = await fetchNewsMentions(m.nombre, failedSources);
        maestros.push({
          ...m,
          email_institucional: dir.email,
          zona_escolar: dir.zona,
          supervisor_zona: dir.supervisor,
          menciones_publicas: Array.from(new Set([...saimex, ...iebemMentions, ...morelosDocs, ...newsMentions])),
          fuentes_consultadas: [
            "sistemas.sep.gob.mx/consultaDatosEscola",
            "dgpp.sep.gob.mx/Estadi",
            "directorio.sep.gob.mx",
            "iebem.edu.mx/transparencia",
            "transparencia.morelos.gob.mx",
            "SAIMEX",
            "diariodemorelos.com",
            "uniondemorelos.com",
          ],
        });
      }

      if ((i + 1) % SAVE_EVERY === 0) {
        await saveProgress(escuela.cct, { maestros, escuelasSinDirector });
      }
    }

    await saveProgress(escuelas[escuelas.length - 1].cct, { maestros, escuelasSinDirector });

    if (maestros.length === 0) {
      await sendNoDataMessage();
      return;
    }

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
  } catch (err) {
    log.error({ err }, "Error en scraper maestros; cerrando de forma controlada para evitar loop");
    await sendNoDataMessage();
  }
}
