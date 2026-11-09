/**
 * Prueba de IA de costo mínimo: UNA sola invocación con el mismo proveedor,
 * base URL, cabeceras y modelo primario que usa `analyzeTenderDocument` en
 * producción (AI_PROVIDER, OPENROUTER_BASE_URL, PRIMARY_AI_MODEL/OPENAI_MODEL).
 * No imprime claves. Clasifica el fallo: credenciales, facturación/créditos,
 * cuota/límite, modelo o red.
 *
 * Uso en Railway:  railway run npx ts-node scripts/ai-smoke.ts
 */
import OpenAI from "openai";

const provider = process.env.AI_PROVIDER || "openai";
const model = process.env.PRIMARY_AI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
const baseURL = provider === "openrouter" ? process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1" : undefined;
const apiKey = provider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY;

function classify(status: number | undefined, message: string): string {
  if (status === 401 || status === 403) return "CREDENCIALES (clave inválida, revocada o sin permiso)";
  if (status === 402) return "FACTURACIÓN (créditos agotados o método de pago)";
  if (status === 429) return /quota|credit|insufficient|billing/i.test(message) ? "CUOTA/FACTURACIÓN" : "LÍMITE DE TASA (reintentar más tarde)";
  if (status === 400 || status === 404) return "MODELO (inexistente, retirado o parámetros no soportados)";
  if (status === undefined) return "RED/CONECTIVIDAD";
  return `PROVEEDOR (HTTP ${status})`;
}

async function main(): Promise<void> {
  console.log(JSON.stringify({ provider, model, baseURL: baseURL ?? "default", apiKeyConfigured: Boolean(apiKey) }));
  if (!apiKey) {
    console.log(`RESULTADO: FALTA CREDENCIAL — ${provider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY"} no está configurada en este entorno`);
    process.exitCode = 2;
    return;
  }
  const client = new OpenAI({
    apiKey, baseURL, maxRetries: 0, timeout: 30_000,
    defaultHeaders: provider === "openrouter" ? { "HTTP-Referer": "https://radar-licitaciones.mx", "X-Title": "Radar Licitaciones MX" } : undefined,
  });
  const started = Date.now();
  try {
    const completion = await client.chat.completions.create({
      model, temperature: 0, max_tokens: 20, response_format: { type: "json_object" },
      messages: [{ role: "user", content: 'Responde únicamente con este JSON: {"ok": true}' }],
    });
    const content = completion.choices[0]?.message?.content ?? "";
    let valid = false;
    try { valid = JSON.parse(content)?.ok === true; } catch { /* no es JSON */ }
    console.log(`RESULTADO: ${valid ? "OK" : "RESPUESTA NO VÁLIDA"} en ${Date.now() - started} ms | modelo servido: ${completion.model} | tokens: ${JSON.stringify(completion.usage ?? {})}`);
    process.exitCode = valid ? 0 : 3;
  } catch (err) {
    const e = err as { status?: number; message?: string; code?: string };
    console.log(`RESULTADO: FALLO — ${classify(e.status, e.message ?? "")} | status=${e.status ?? "n/a"} code=${e.code ?? "n/a"} | ${(e.message ?? "").slice(0, 160)}`);
    process.exitCode = 1;
  }
}
void main();
