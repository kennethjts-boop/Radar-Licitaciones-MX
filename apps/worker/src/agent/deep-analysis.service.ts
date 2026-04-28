import { unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import axios from "axios";
import OpenAI from "openai";
import { getConfig } from "../config/env";
import { createModuleLogger } from "../core/logger";
import { BrowserManager } from "../collectors/comprasmx/browser.manager";
import { ComprasMxNavigator } from "../collectors/comprasmx/comprasmx.navigator";
import { extractTextFromPdf } from "../utils/pdf.util";
import { getSupabaseClient } from "../storage/client";

const log = createModuleLogger("agent-deep-analysis");

export interface DeepAnalysisReport {
  resumen: string;
  fechas_criticas: string[];
  presupuesto_estimado: string;
  requisitos_experiencia: string[];
  candados_detectados: string[];
  veredicto: string;
  comparativo_capufe: string;
}

export interface DeepAnalysisResult {
  title: string;
  expedienteId: string;
  report: DeepAnalysisReport;
}

export interface DeepAnalysisOptions {
  onProgress?: (progress: number, message: string) => Promise<void> | void;
  maxPdfPages?: number;
}

function getOpenAIClient(): any {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY no configurada para Deep Analysis");
  }
  return new OpenAI({ apiKey });
}

async function getCapufeHistoricalContext(): Promise<string> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("procurements")
    .select("title,amount,currency,publication_date,dependency_name")
    .ilike("dependency_name", "%CAPUFE%")
    .not("amount", "is", null)
    .order("publication_date", { ascending: false })
    .limit(8);

  if (error) {
    log.warn({ error }, "No se pudo cargar histórico CAPUFE");
    return "Sin histórico disponible";
  }

  if (!data || data.length === 0) {
    return "Sin histórico CAPUFE con montos";
  }

  return data
    .map(
      (row) =>
        `- ${row.publication_date ?? "sin fecha"} | ${row.title ?? "sin título"} | ${row.amount ?? "N/D"} ${row.currency ?? "MXN"}`,
    )
    .join("\n");
}

async function downloadPdfText(
  url: string,
  maxPages: number,
): Promise<string> {
  const tempPath = join(tmpdir(), `agent-${randomUUID()}.pdf`);

  try {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: 45_000,
      headers: {
        "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });

    await writeFile(tempPath, Buffer.from(response.data));
    return await extractTextFromPdf(tempPath, {
      maxPages,
      maxChars: 150_000,
    });
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

function pickTargetAttachments(
  attachments: Array<{ fileName: string; fileUrl: string }>,
): Array<{ fileName: string; fileUrl: string }> {
  const normalized = attachments.filter((a) => a.fileUrl && /pdf/i.test(a.fileUrl));
  const convocatoria = normalized.find((a) => /convocatoria|bases/i.test(a.fileName));
  const anexo = normalized.find((a) => /anexo/i.test(a.fileName));

  const picked = [convocatoria, anexo].filter(
    (item): item is { fileName: string; fileUrl: string } => !!item,
  );

  if (picked.length >= 2) return picked.slice(0, 2);

  for (const file of normalized) {
    if (picked.find((x) => x.fileUrl === file.fileUrl)) continue;
    picked.push(file);
    if (picked.length >= 2) break;
  }

  return picked;
}

async function loadDetailByExpediente(expedienteId: string): Promise<{
  title: string;
  expedienteId: string;
  attachmentUrls: Array<{ fileName: string; fileUrl: string }>;
}> {
  const config = getConfig();
  const navigator = new ComprasMxNavigator();

  return BrowserManager.withContext(async (page, context) => {
    await page.goto(config.COMPRASMX_SEED_URL, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });

    const raw = await navigator.extractDetail(context, expedienteId, page);
    if (!raw) {
      throw new Error(`No se pudo extraer detalle para expediente ${expedienteId}`);
    }

    const linksFromPage = await page.evaluate(() => {
      // @ts-ignore
      const anchors = Array.from(document.querySelectorAll('a[href]')) as any[];
      return anchors
        .map((a) => ({
          fileName: (a.textContent || "Documento").trim(),
          fileUrl: String(a.href || ""),
        }))
        .filter((x) => /pdf/i.test(x.fileUrl));
    });

    const rawAttachments = (raw.attachments ?? [])
      .map((a) => ({
        fileName: a.fileName || "Documento",
        fileUrl: a.fileUrl || "",
      }))
      .filter((a) => a.fileUrl);

    const merged = [...rawAttachments, ...linksFromPage];

    return {
      title: raw.title || "Sin título",
      expedienteId: raw.externalId || expedienteId,
      attachmentUrls: pickTargetAttachments(merged),
    };
  });
}

async function runStrategicPrompt(input: {
  expedienteId: string;
  title: string;
  convocatoriaText: string;
  anexoText: string;
  historicalContext: string;
}): Promise<DeepAnalysisReport> {
  const client = getOpenAIClient();

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "deep_licitacion_report",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "resumen",
            "fechas_criticas",
            "presupuesto_estimado",
            "requisitos_experiencia",
            "candados_detectados",
            "veredicto",
            "comparativo_capufe",
          ],
          properties: {
            resumen: { type: "string" },
            fechas_criticas: { type: "array", items: { type: "string" }, maxItems: 6 },
            presupuesto_estimado: { type: "string" },
            requisitos_experiencia: { type: "array", items: { type: "string" }, maxItems: 6 },
            candados_detectados: { type: "array", items: { type: "string" }, maxItems: 6 },
            veredicto: { type: "string" },
            comparativo_capufe: { type: "string" },
          },
        },
      },
    },
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "Eres Analista Senior de Licitaciones para Kenneth. Extrae señales estratégicas accionables y evita inventar datos.",
      },
      {
        role: "user",
        content: [
          `Expediente: ${input.expedienteId}`,
          `Título: ${input.title}`,
          "",
          "Objetivo:",
          "1) Resumen ejecutivo.",
          "2) Fechas críticas de presentación/visita/junta/aclaraciones/fallo.",
          "3) Presupuesto estimado (o indicar No especificado).",
          "4) Requisitos de experiencia.",
          "5) Candados técnicos/comerciales.",
          "6) Veredicto de oportunidad para Kenneth (alto/medio/bajo + por qué).",
          "7) Comparar con histórico CAPUFE dado (precios/patrones).",
          "",
          "Histórico CAPUFE:",
          input.historicalContext,
          "",
          "Convocatoria (texto):",
          input.convocatoriaText.slice(0, 90_000),
          "",
          "Anexo Técnico (texto):",
          input.anexoText.slice(0, 90_000),
        ].join("\n"),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI no devolvió contenido para Deep Analysis");
  }

  return JSON.parse(content) as DeepAnalysisReport;
}

export async function analyzeSelectedLicitacion(
  expedienteId: string,
  options: DeepAnalysisOptions = {},
): Promise<DeepAnalysisResult> {
  const onProgress = options.onProgress;
  const maxPdfPages = options.maxPdfPages ?? 40;

  await onProgress?.(10, "🔎 Abriendo detalle de licitación (10%)...");
  const detail = await loadDetailByExpediente(expedienteId);
  await onProgress?.(20, "📚 Consultando histórico CAPUFE (20%)...");
  const historicalContext = await getCapufeHistoricalContext();

  let convocatoriaText = "";
  let anexoText = "";

  await onProgress?.(25, "📄 Leyendo anexos (25%)...");
  for (const attachment of detail.attachmentUrls) {
    const text = await downloadPdfText(attachment.fileUrl, maxPdfPages).catch((err) => {
      log.warn({ err, attachment }, "No se pudo leer PDF de adjunto");
      return "";
    });

    if (/convocatoria|bases/i.test(attachment.fileName) && !convocatoriaText) {
      convocatoriaText = text;
      continue;
    }

    if (/anexo/i.test(attachment.fileName) && !anexoText) {
      anexoText = text;
      continue;
    }

    if (!convocatoriaText) {
      convocatoriaText = text;
    } else if (!anexoText) {
      anexoText = text;
    }
  }

  if (!convocatoriaText && !anexoText) {
    throw new Error("No se pudieron descargar textos de Convocatoria/Anexo para el análisis");
  }

  await onProgress?.(60, "🤖 Analizando con IA (60%)...");
  const report = await runStrategicPrompt({
    expedienteId: detail.expedienteId,
    title: detail.title,
    convocatoriaText,
    anexoText,
    historicalContext,
  });

  await onProgress?.(90, "🧾 Armando expediente final (90%)...");
  return {
    title: detail.title,
    expedienteId: detail.expedienteId,
    report,
  };
}

export async function analyzeLicitacionByUrl(
  url: string,
  options: DeepAnalysisOptions = {},
): Promise<DeepAnalysisResult> {
  const expedienteFromUrl = (url.match(/[A-Z0-9-]{8,}/i)?.[0] ?? "manual-link").toUpperCase();
  return analyzeSelectedLicitacion(expedienteFromUrl, options);
}

