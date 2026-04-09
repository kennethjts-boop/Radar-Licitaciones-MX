import "dotenv/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { analyzeTenderDocument } from "../ai/openai.service";
import { sendTelegramLongReport } from "../alerts/telegram.alerts";
import { createModuleLogger } from "../core/logger";

const KEYWORDS = ["bolet", "peaje", "papel term", "papel térm", "rollo term", "rollo térm"];
const log = createModuleLogger("capufe-peaje-deep-report");
const WAITING_CAPUFE_MESSAGE = "Esperando documentos de CAPUFE...";

type LatestRow = {
  attachment_id: string;
  file_name: string;
  created_at: string;
  detected_text: string | null;
  storage_path: string | null;
  source_url: string | null;
  procurement_id: string;
  title: string | null;
  dependency_name: string | null;
  procedure_number: string | null;
  licitation_number: string | null;
  publication_date: string | null;
  opening_date: string | null;
  award_date: string | null;
  source_proc_url: string | null;
  analysis_id: string | null;
  summary: string | null;
  opportunities: string[] | null;
  risks: string[] | null;
  red_flags: string[] | null;
  guarantees: string | null;
  deadline: string | null;
  win_probability: number | null;
  score_total: number | null;
};

type HistoricalRow = {
  procurement_id: string;
  title: string | null;
  publication_date: string | null;
  opening_date: string | null;
  award_date: string | null;
  file_name: string | null;
  detected_text: string | null;
  summary: string | null;
  guarantees: string | null;
  red_flags: string[] | null;
  score_total: number | null;
  win_probability: number | null;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Falta variable requerida: ${name}`);
  }
  return value.trim();
}

function getDb(): SupabaseClient {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function matchesKeyword(text: string): boolean {
  const t = text.toLowerCase();
  return KEYWORDS.some((kw) => t.includes(kw));
}

function collectUnique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((v) => (v ?? "").trim()).filter(Boolean))];
}

function extract(pattern: RegExp, text: string): string[] {
  const out: string[] = [];
  const normalized = text.replace(/\r/g, "\n");
  const matches = normalized.matchAll(pattern);
  for (const match of matches) {
    const value = match[0].replace(/\s+/g, " ").trim();
    if (value) out.push(value);
  }
  return [...new Set(out)];
}

function extractPrices(text: string): string[] {
  return extract(/(?:\$\s?\d{1,3}(?:[,\.]\d{3})*(?:[\.,]\d{2})?|\d+(?:[\.,]\d{2})\s?(?:MXN|M\.N\.|pesos))/gi, text);
}

function extractTechnicalSpecs(text: string): string[] {
  return extract(/(?:gramaje\s*[:\-]?\s*\d{1,3}\s*g\/?m2|\d{2,3}\s*mm\s*[x×]\s*\d{2,3}\s*m|medidas?\s*[:\-]?\s*[^\n\.]{3,80}|marca de agua|fibras? de seguridad|microtexto|papel térmico[^\n\.]{0,120})/gi, text);
}

function extractCalendar(text: string): string[] {
  return extract(/(?:junta de aclaraciones|presentaci[oó]n y apertura|apertura de proposiciones|fallo|visita al sitio)[^\n\.]{0,140}/gi, text);
}

function extractLogistics(text: string): string[] {
  return extract(/(?:lugar(?:es)? de entrega|entrega en|plaza de cobro|almac[eé]n|centro de distribuci[oó]n|partida\s*\d+|cantidad(?:es)?\s*[:\-]?\s*\d+)/gi, text);
}

function extractFinancial(text: string): string[] {
  return extract(/(?:capital contable[^\n\.]{0,120}|garant[ií]a de cumplimiento[^\n\.]{0,120}|fianza[^\n\.]{0,120}|garant[ií]a de seriedad[^\n\.]{0,120})/gi, text);
}

async function queryLatestCapufeDocument(
  db: SupabaseClient,
  procurementId?: string,
): Promise<LatestRow | null> {
  let query = db
    .from("attachments")
    .select(`
      id,
      file_name,
      created_at,
      detected_text,
      storage_path,
      source_url,
      procurement:procurements!inner(
        id,
        title,
        dependency_name,
        procedure_number,
        licitation_number,
        publication_date,
        opening_date,
        award_date,
        source_url
      ),
      analysis:document_analysis(
        id,
        summary,
        opportunities,
        risks,
        red_flags,
        guarantees,
        deadline,
        win_probability,
        score_total
      )
    `);

  if (procurementId) {
    query = query.eq("procurement_id", procurementId);
  } else {
    query = query.ilike("procurements.dependency_name", "%CAPUFE%");
  }

  const { data, error } = await query.order("created_at", { ascending: false }).limit(80);

  if (error) throw new Error(`Error consultando adjuntos CAPUFE: ${error.message}`);

  const rows = Array.isArray(data) ? data : [];
  for (const row of rows) {
    const procurement = Array.isArray(row.procurement) ? row.procurement[0] : row.procurement;
    const analysis = Array.isArray(row.analysis) ? row.analysis[0] : row.analysis;

    const mergedText = `${procurement?.title ?? ""} ${row.file_name ?? ""} ${row.detected_text ?? ""}`;
    if (!matchesKeyword(mergedText)) continue;

    return {
      attachment_id: row.id,
      file_name: row.file_name,
      created_at: row.created_at,
      detected_text: row.detected_text,
      storage_path: row.storage_path,
      source_url: row.source_url,
      procurement_id: procurement?.id,
      title: procurement?.title ?? null,
      dependency_name: procurement?.dependency_name ?? null,
      procedure_number: procurement?.procedure_number ?? null,
      licitation_number: procurement?.licitation_number ?? null,
      publication_date: procurement?.publication_date ?? null,
      opening_date: procurement?.opening_date ?? null,
      award_date: procurement?.award_date ?? null,
      source_proc_url: procurement?.source_url ?? null,
      analysis_id: analysis?.id ?? null,
      summary: analysis?.summary ?? null,
      opportunities: analysis?.opportunities ?? null,
      risks: analysis?.risks ?? null,
      red_flags: analysis?.red_flags ?? null,
      guarantees: analysis?.guarantees ?? null,
      deadline: analysis?.deadline ?? null,
      win_probability: analysis?.win_probability ?? null,
      score_total: analysis?.score_total ?? null,
    };
  }

  return null;
}

async function queryHistoricalCapufe(
  db: SupabaseClient,
  procurementId?: string,
): Promise<HistoricalRow[]> {
  let query = db
    .from("attachments")
    .select(`
      file_name,
      detected_text,
      procurement:procurements!inner(
        id,
        title,
        dependency_name,
        publication_date,
        opening_date,
        award_date
      ),
      analysis:document_analysis(
        summary,
        guarantees,
        red_flags,
        score_total,
        win_probability
      )
    `);

  if (procurementId) {
    query = query.eq("procurement_id", procurementId);
  } else {
    query = query.ilike("procurements.dependency_name", "%CAPUFE%");
  }

  const { data, error } = await query.order("created_at", { ascending: false }).limit(400);

  if (error) throw new Error(`Error histórico CAPUFE: ${error.message}`);

  const rows = Array.isArray(data) ? data : [];
  const history: HistoricalRow[] = [];

  for (const row of rows) {
    const procurement = Array.isArray(row.procurement) ? row.procurement[0] : row.procurement;
    const analysis = Array.isArray(row.analysis) ? row.analysis[0] : row.analysis;
    const mergedText = `${procurement?.title ?? ""} ${row.file_name ?? ""} ${row.detected_text ?? ""}`;
    if (!matchesKeyword(mergedText)) continue;

    history.push({
      procurement_id: procurement?.id,
      title: procurement?.title ?? null,
      publication_date: procurement?.publication_date ?? null,
      opening_date: procurement?.opening_date ?? null,
      award_date: procurement?.award_date ?? null,
      file_name: row.file_name ?? null,
      detected_text: row.detected_text ?? null,
      summary: analysis?.summary ?? null,
      guarantees: analysis?.guarantees ?? null,
      red_flags: analysis?.red_flags ?? null,
      score_total: analysis?.score_total ?? null,
      win_probability: analysis?.win_probability ?? null,
    });
  }

  return history;
}

async function forceAnalyzeIfMissing(db: SupabaseClient, latest: LatestRow): Promise<boolean> {
  if (latest.analysis_id) return false;

  const text = (latest.detected_text ?? "").trim();
  if (!text) return false;

  const filteredText = text.length > 40_000 ? text.slice(0, 40_000) : text;
  const analysis = await analyzeTenderDocument(filteredText);

  const { error } = await db.from("document_analysis").upsert(
    {
      attachment_id: latest.attachment_id,
      score_total: analysis.scores.total,
      score_tech: analysis.scores.technical,
      score_commercial: analysis.scores.commercial,
      score_urgency: analysis.scores.urgency,
      score_viability: analysis.scores.viability,
      contract_type: analysis.key_data.contract_type,
      deadline: analysis.key_data.deadline,
      guarantees: analysis.key_data.guarantees,
      summary: analysis.summary,
      opportunities: analysis.opportunities,
      risks: analysis.risks,
      win_probability: analysis.opportunity_engine.win_probability,
      competitor_threat_level: analysis.opportunity_engine.competitor_threat_level,
      implementation_complexity: analysis.opportunity_engine.implementation_complexity,
      red_flags: analysis.opportunity_engine.red_flags,
      category_detected: analysis.category_detected,
      is_relevant: analysis.is_relevant,
      relevance_justification: analysis.relevance_justification,
    },
    { onConflict: "attachment_id" },
  );

  if (error) {
    throw new Error(`No se pudo forzar análisis del último adjunto: ${error.message}`);
  }

  return true;
}

function buildExecutiveReport(latest: LatestRow, historical: HistoricalRow[]): string {
  const latestText = latest.detected_text ?? "";

  const historicalTexts = historical
    .map((row) => row.detected_text ?? "")
    .filter((t) => t && matchesKeyword(t))
    .join("\n\n");

  const latestPrices = extractPrices(latestText);
  const historicalPrices = extractPrices(historicalTexts);

  const technicalCurrent = extractTechnicalSpecs(latestText);
  const technicalHistorical = extractTechnicalSpecs(historicalTexts);

  const calendarItems = collectUnique([
    ...extractCalendar(latestText),
    latest.publication_date ? `publicación: ${latest.publication_date}` : null,
    latest.opening_date ? `apertura: ${latest.opening_date}` : null,
    latest.award_date ? `fallo/adjudicación: ${latest.award_date}` : null,
    latest.deadline ? `fecha límite detectada IA: ${latest.deadline}` : null,
  ]);

  const logistics = extractLogistics(latestText);
  const financial = collectUnique([...extractFinancial(latestText), latest.guarantees]);

  const redFlags = collectUnique([...(latest.red_flags ?? []), ...extract(/(?:requisito[^\n\.]{0,130}|obligatorio[^\n\.]{0,130}|compatible con[^\n\.]{0,130}|marca[^\n\.]{0,80})/gi, latestText)]);

  const yearlyBuckets = new Map<string, number>();
  for (const row of historical) {
    const year = row.publication_date?.slice(0, 4) ?? "sin_fecha";
    yearlyBuckets.set(year, (yearlyBuckets.get(year) ?? 0) + 1);
  }

  const yearSummary = [...yearlyBuckets.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, count]) => `${year}: ${count}`)
    .join(" | ");

  return [
    "# REPORTE TÉCNICO COMPLETO — CAPUFE (BOLETOS DE PEAJE / PAPEL TÉRMICO)",
    `Fecha de ejecución: ${new Date().toISOString()}`,
    "",
    "## 1) Documento base detectado (más reciente)",
    `- Procurement ID: ${latest.procurement_id}`,
    `- Attachment ID: ${latest.attachment_id}`,
    `- Archivo: ${latest.file_name}`,
    `- Dependencia: ${latest.dependency_name ?? "No especificado"}`,
    `- Título: ${latest.title ?? "No especificado"}`,
    `- Número procedimiento: ${latest.procedure_number ?? "No especificado"}`,
    `- Número licitación: ${latest.licitation_number ?? "No especificado"}`,
    `- Fecha publicación: ${latest.publication_date ?? "No especificado"}`,
    `- URL expediente: ${latest.source_proc_url ?? "No especificado"}`,
    `- URL fuente adjunto: ${latest.source_url ?? "No especificado"}`,
    "",
    "## 2) Memoria histórica RAG (CAPUFE similares)",
    `- Registros históricos recuperados: ${historical.length}`,
    `- Distribución por año: ${yearSummary || "sin datos"}`,
    `- Score total (último): ${latest.score_total ?? "N/D"}`,
    `- Win probability (último): ${latest.win_probability ?? "N/D"}`,
    `- Resumen IA (último): ${latest.summary ?? "No disponible"}`,
    "",
    "## 3) Comparativo de precios unitarios (histórico vs actual)",
    `- Precios detectados en convocatoria actual: ${latestPrices.length ? latestPrices.join(" | ") : "No detectados en texto extraído"}`,
    `- Precios detectados en histórico: ${historicalPrices.length ? historicalPrices.slice(0, 25).join(" | ") : "No detectados"}`,
    "- Nota metodológica: extracción por patrones monetarios en texto OCR/documento; validar con cuadro de partidas oficial.",
    "",
    "## 4) Cambios técnicos (gramaje, medidas, seguridad)",
    `- Convocatoria actual: ${technicalCurrent.length ? technicalCurrent.join(" | ") : "No se identificaron fichas técnicas explícitas"}`,
    `- Históricos: ${technicalHistorical.length ? technicalHistorical.slice(0, 20).join(" | ") : "Sin evidencia comparable"}`,
    "",
    "## 5) Deep Dive — Calendario crítico",
    ...calendarItems.map((x) => `- ${x}`),
    "",
    "## 6) Deep Dive — Logística (entregas y cantidades)",
    ...(logistics.length ? logistics.map((x) => `- ${x}`) : ["- No se encontraron lugares/cantidades explícitas en el texto disponible."]),
    "",
    "## 7) Deep Dive — Requisitos financieros y garantías",
    ...(financial.length ? financial.map((x) => `- ${x}`) : ["- No se detectó capital contable mínimo ni garantías en texto parseado."]),
    "",
    "## 8) Deep Dive — Candados / Riesgo de direccionamiento",
    ...(redFlags.length ? redFlags.slice(0, 30).map((x) => `- ${x}`) : ["- Sin candados explícitos detectados por regex; revisar anexos técnicos manualmente."]),
    "",
    "## 9) Recomendaciones accionables",
    "- Validar cuadro de partidas y precios unitarios en PDF original para consolidar estrategia de margen.",
    "- Confirmar requisitos de papel de seguridad (marca de agua, microtexto, fibras) contra capacidad fabril del proveedor.",
    "- Preparar matriz de cumplimiento documental y financiero antes de junta de aclaraciones.",
    "- Lanzar preguntas en junta para neutralizar especificaciones cerradas/compatibilidades restrictivas.",
  ].join("\n");
}

export async function generateCapufePeajeDeepReport(options?: {
  procurementId?: string;
  forceProcess?: boolean;
}): Promise<{ report: string; forced: boolean; procurementId: string; attachmentId: string } | null> {
  const db = getDb();
  const force = options?.forceProcess ?? false;
  const procurementId = options?.procurementId;

  const latest = await queryLatestCapufeDocument(db, procurementId);
  if (!latest) {
    log.info(
      { event: "CAPUFE_WAITING_DOCUMENTS", procurementId: procurementId ?? null },
      WAITING_CAPUFE_MESSAGE,
    );
    return null;
  }

  let forced = false;
  if (force) {
    forced = await forceAnalyzeIfMissing(db, latest);
  }

  const historical = await queryHistoricalCapufe(db, latest.procurement_id);
  const report = buildExecutiveReport(latest, historical);

  return {
    report,
    forced,
    procurementId: latest.procurement_id,
    attachmentId: latest.attachment_id,
  };
}

export async function sendCapufePeajeDeepReportToTelegram(options?: {
  procurementId?: string;
  forceProcess?: boolean;
}): Promise<boolean> {
  const result = await generateCapufePeajeDeepReport(options);
  if (!result) {
    return false;
  }

  await sendTelegramLongReport(
    `REPORTE DEEP CAPUFE/PEAJE — Procurement ${result.procurementId}`,
    result.report,
  );

  log.info(
    {
      event: "CAPUFE_DEEP_REPORT_SENT",
      procurementId: result.procurementId,
      attachmentId: result.attachmentId,
      forced: result.forced,
    },
    "Reporte Deep de CAPUFE enviado a Telegram",
  );

  return true;
}

async function run(): Promise<void> {
  const force = process.argv.includes("--force-process");
  const result = await generateCapufePeajeDeepReport({ forceProcess: force });
  if (!result) {
    console.info(`[INFO] ${WAITING_CAPUFE_MESSAGE}`);
    return;
  }

  console.log(result.report);
  if (force) {
    console.log(`\n[INFO] Force processing solicitado: ${result.forced ? "análisis ejecutado" : "no fue necesario o faltó texto detectado"}`);
  }
}

run().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`❌ ${message}`);
  process.exit(1);
});
