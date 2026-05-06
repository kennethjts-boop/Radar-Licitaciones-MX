import { extractTextFromPdf } from "../utils/pdf.util";
import { detectAbusiveClauses } from "../ai/openai.service";
import path from "path";
import fs from "fs";

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Uso: npm run ts-node src/scripts/analyze-abusive-clauses.ts <ruta_al_pdf>");
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`Error: El archivo no existe en ${absolutePath}`);
    process.exit(1);
  }

  console.log(`\n🔎 Analizando documento: ${path.basename(absolutePath)}...`);

  try {
    const text = await extractTextFromPdf(absolutePath);
    
    if (!text) {
      console.error("No se pudo extraer texto del PDF (podría ser una imagen o estar protegido).");
      process.exit(1);
    }

    console.log(`📄 Texto extraído (${text.length} caracteres). Enviando a Gemma 4...`);

    const result = await detectAbusiveClauses(text);

    console.log("\n==================================================");
    console.log("🛡️  REPORTE DE AUDITORÍA DE CLÁUSULAS ABUSIVAS");
    console.log("==================================================");
    console.log(`\n🎯 Probabilidad de Licitación Dirigida: ${result.score}%`);
    console.log(`🚨 Veredicto: ${result.is_likely_directed ? "⚠️ ALTA PROBABILIDAD DE SESGO" : "✅ APARENTE TRANSPARENCIA"}`);

    if (result.abusive_clauses.length > 0) {
      console.log("\n🚩 Hallazgos Detallados:");
      result.abusive_clauses.forEach((item, index) => {
        console.log(`\n[${index + 1}] Severidad: ${item.severity}`);
        console.log(`   Cláusula: "${item.clause.substring(0, 150)}${item.clause.length > 150 ? '...' : ''}"`);
        console.log(`   Razón: ${item.reason}`);
      });
    } else {
      console.log("\n✅ No se encontraron cláusulas abusivas evidentes.");
    }

    console.log("\n==================================================");

  } catch (error) {
    console.error("\n❌ Error durante el análisis:");
    console.error(error instanceof Error ? error.message : String(error));
  }
}

main();
