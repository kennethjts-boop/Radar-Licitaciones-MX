import { analyzeTenderDocument } from "../ai/openai.service";
import { createModuleLogger } from "../core/logger";
import * as dotenv from "dotenv";
import * as path from "path";

// Cargar variables de entorno
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const log = createModuleLogger("test-ai-v2");

async function runTest() {
  log.info("🚀 Iniciando Test de IA V2 (Gemma 4 + Fallback)...");

  const sampleText = `
    LICITACIÓN PÚBLICA NACIONAL No. LA-001-2024
    OBJETO: Adquisición de licencias de software de ciberseguridad y servicios de consultoría.
    REQUISITOS TÉCNICOS:
    - Los participantes deben contar con la certificación ISO 27001 (Indispensable).
    - Tiempo de entrega: 3 días naturales después del fallo.
    - Capital contable mínimo requerido: $10,000,000 MXN.
    
    DEPENDENCIA: Secretaría de Innovación Digital.
  `;

  try {
    const analysis = await analyzeTenderDocument(sampleText);
    
    console.log("\n--- RESULTADO DEL ANÁLISIS ---");
    console.log(JSON.stringify(analysis, null, 2));
    
    if (analysis.fraud_radar?.is_likely_directed) {
      log.warn("⚠️ ALERTA DE FRAUDE DETECTADA POR LA IA");
    }
    
    log.info("✅ Test completado con éxito.");
  } catch (error: any) {
    log.error({ error: error.message || String(error) }, "❌ Fallo en el test de IA");
  }
}

runTest();
