
import "dotenv/config";
import { runApuestasRadar } from "../radars/apuestas.radar";
import axios from "axios";

async function debugApuestas() {
  const apiKey = process.env.ODDS_API_KEY;
  console.log("--- DEBUG RADAR APUESTAS ---");
  console.log(`API Key configurada: ${apiKey ? 'SÍ (termina en ' + apiKey.slice(-4) + ')' : 'NO'}`);

  if (!apiKey) {
    console.error("❌ ERROR: No hay ODDS_API_KEY en el .env");
    return;
  }

  // 1. Probar conectividad básica
  console.log("\n1. Probando conectividad con The-Odds-API...");
  try {
    const res = await axios.get("https://api.the-odds-api.com/v4/sports", { params: { apiKey } });
    console.log(`✅ Conexión exitosa. Ligas disponibles en el plan: ${res.data.length}`);
  } catch (err: any) {
    console.error(`❌ ERROR de conexión: ${err.response?.data?.message || err.message}`);
    if (err.response?.status === 401) console.error("   (La API Key parece ser inválida o estar vencida)");
    return;
  }

  // 2. Ejecutar radar completo
  console.log("\n2. Ejecutando runApuestasRadar()...");
  try {
    const results = await runApuestasRadar();
    console.log(`\n--- RESULTADOS ---`);
    console.log(`Total oportunidades encontradas: ${results.length}`);
    
    results.forEach((r, i) => {
      console.log(`${i+1}. [${r.tipo}] ${r.evento}: ${r.resultado1X2}`);
      console.log(`   Score: ${r.score} | Cuota: ${r.cuotaRecomendada} (${r.casaRecomendada})`);
      console.log(`   Edge: ${(r.probabilidadModeladaPct - r.probabilidadImplicitaPct).toFixed(1)}%`);
    });
  } catch (err: any) {
    console.error("❌ ERROR ejecutando el radar:", err.message);
  }
}

debugApuestas().catch(console.error);
