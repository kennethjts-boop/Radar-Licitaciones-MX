import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const PRIMARY_MODEL = "google/gemma-4-31b-it:free";

const EXPERT_SYSTEM_PROMPT = `Eres un Consultor Experto en Licitaciones Públicas Mexicanas con 20 años de experiencia ayudando a empresas privadas a ganar contratos gubernamentales.

Tu rol es actuar como un aliado estratégico que lee los documentos de una licitación y produce un análisis accionable y honesto. NO inventes información que no esté en el documento. Si no hay suficiente contexto, dilo explícitamente.

Responde ÚNICAMENTE con JSON válido, sin texto extra, sin markdown, sin bloques de código.

Formato de respuesta:
{
  "antecedentes": "string — 2-3 oraciones explicando el contexto histórico y/o perfil conocido de la dependencia convocante basándote en la información del documento. Si no hay antecedentes históricos disponibles, indica explícitamente que no se encontró historial.",
  "resumen_ejecutivo": "string — 1 párrafo corto con la esencia de la licitación: qué piden, cuánto vale, cuándo, y tu veredicto general.",
  "tips_ganadores": [
    "string — tip concreto y accionable basado en los documentos reales",
    "string",
    "string"
  ],
  "alertas_riesgo": [
    "string — posibles candados, requisitos restrictivos o señales de licitación dirigida",
    "string"
  ],
  "fase_tecnica": [
    "string — requisito técnico crítico encontrado en las bases",
    "string",
    "string"
  ],
  "fase_economica": [
    "string — aspecto económico/financiero crítico: fianzas, anticipos, montos, penalizaciones",
    "string",
    "string"
  ],
  "score_oportunidad": number (0-100, basado en: relevancia, viabilidad, probabilidad de ganar, apertura del concurso),
  "probabilidad_ganar": number (0-100),
  "veredicto": "ALTA_OPORTUNIDAD" | "OPORTUNIDAD_MODERADA" | "RIESGO_ELEVADO" | "POSIBLE_DIRIGIDA"
}`;

interface RequestBody {
  procurement_id: string;
  title?: string;
  dependency_name?: string;
  state?: string;
  amount?: number;
  licitation_number?: string;
  // Attachment text extracted from PDFs (passed from frontend or fetched here)
  document_text?: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY no configurada en Edge Function");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Variables de Supabase no configuradas");

    const body: RequestBody = await req.json();
    const { procurement_id, title, dependency_name, state, amount, licitation_number } = body;

    if (!procurement_id) {
      return new Response(JSON.stringify({ error: "procurement_id es requerido" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Fetch procurement data + attachments from Supabase
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Buscar texto de adjuntos ya almacenados en document_analysis
    const { data: analysisRows } = await db
      .from("document_analysis")
      .select("summary, opportunities, risks, relevance_justification, score_total, win_probability, contract_type, deadline, guarantees")
      .eq("attachment_id", procurement_id) // Intentar con attachment_id
      .limit(3);

    // También buscar por procurement_id en attachments
    const { data: attachments } = await db
      .from("attachments")
      .select("id, file_name, document_analysis(summary, opportunities, risks, contract_type, deadline, guarantees, score_total, win_probability)")
      .eq("procurement_id", procurement_id)
      .limit(5);

    // Construir contexto para el prompt
    const procContext = [
      `Título: ${title || "No especificado"}`,
      `Número de Licitación: ${licitation_number || "No especificado"}`,
      `Dependencia Convocante: ${dependency_name || "No especificada"}`,
      `Estado Geográfico: ${state || "No especificado"}`,
      `Monto Estimado: ${amount ? `$${amount.toLocaleString()} MXN` : "No especificado"}`,
    ].join("\n");

    // Recolectar análisis previos si existen
    let previousAnalysisContext = "";
    if (attachments && attachments.length > 0) {
      const analyses = attachments
        .map((att: any) => {
          const da = att.document_analysis;
          if (!da || (Array.isArray(da) && da.length === 0)) return null;
          const d = Array.isArray(da) ? da[0] : da;
          if (!d) return null;
          return [
            `Archivo: ${att.file_name}`,
            d.summary ? `  Resumen IA Worker: ${d.summary}` : "",
            d.contract_type ? `  Tipo contrato: ${d.contract_type}` : "",
            d.deadline ? `  Plazo: ${d.deadline}` : "",
            d.guarantees ? `  Garantías: ${d.guarantees}` : "",
            d.opportunities?.length ? `  Oportunidades previas: ${(d.opportunities as string[]).join(" | ")}` : "",
            d.risks?.length ? `  Riesgos previos: ${(d.risks as string[]).join(" | ")}` : "",
          ].filter(Boolean).join("\n");
        })
        .filter(Boolean);

      if (analyses.length > 0) {
        previousAnalysisContext = `\n\nDATOS EXTRAÍDOS DE LOS DOCUMENTOS ADJUNTOS:\n${analyses.join("\n\n")}`;
      }
    }

    const userPrompt = `Analiza la siguiente licitación pública mexicana y produce el análisis experto solicitado.

DATOS DE LA LICITACIÓN:
${procContext}
${previousAnalysisContext || "\n(No se encontraron documentos adjuntos analizados previamente. Basa tu análisis en los metadatos disponibles y tu conocimiento del perfil de la dependencia.)"}

INSTRUCCIONES:
- Sé honesto. Si no hay datos suficientes, indícalo en el campo correspondiente.
- Enfócate en lo accionable: qué DEBE hacer la empresa para participar y ganar.
- Detecta si hay señales de "licitación dirigida" o candados restrictivos.
- Calcula score_oportunidad y probabilidad_ganar de forma coherente con los datos.
- Si el monto no está especificado, no inventes una cifra.`;

    // Llamar a OpenRouter
    const openAiResponse = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://radar-licitaciones.mx",
        "X-Title": "Radar Licitaciones MX",
      },
      body: JSON.stringify({
        model: PRIMARY_MODEL,
        temperature: 0.3,
        // Gemma 4 maneja bien JSON sin necesidad de response_format específico si se le pide en el prompt, 
        // pero OpenRouter lo soporta para algunos modelos. Lo mantendremos si es posible o lo omitiremos si falla.
        messages: [
          { role: "system", content: EXPERT_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!openAiResponse.ok) {
      const errText = await openAiResponse.text();
      throw new Error(`OpenAI error ${openAiResponse.status}: ${errText}`);
    }

    const openAiData = await openAiResponse.json();
    const content = openAiData.choices?.[0]?.message?.content;

    if (!content) throw new Error("OpenAI devolvió respuesta vacía");

    const analysis = JSON.parse(content);

    // Guardar en Supabase para no re-cobrar tokens al usuario si ya existe
    await db.from("saas_analyses").upsert({
      procurement_id,
      analysis_json: analysis,
      model_used: PRIMARY_MODEL,
      created_at: new Date().toISOString(),
    }, { onConflict: "procurement_id" }).select().single();

    return new Response(JSON.stringify({ success: true, analysis }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Edge Function error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
