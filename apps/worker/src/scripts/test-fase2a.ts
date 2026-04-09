import "dotenv/config";
import { getSupabaseClient } from "../storage/client";
import {
  collectComprasMx,
  recheckComprasMx,
} from "../collectors/comprasmx/comprasmx.collector";

async function run() {
  console.log("--- TEST FASE 2A ---");
  try {
    const res = await collectComprasMx({ maxPages: 2 });
    console.log("\n--- RESULTADOS MODO 1 ---");
    console.log(JSON.stringify(res, null, 2));

    const db = getSupabaseClient();
    const { data: actives } = await db
      .from("procurements")
      .select("source_url")
      .in("status", [
        "Vigente",
        "activa",
        "en_proceso",
        "Publicado",
        "Por Adjudicar",
      ])
      .limit(3);

    if (actives && actives.length > 0) {
      console.log("\n--- INICIANDO MODO 2 RECHECK ---");
      const urls = actives.map((a) => a.source_url).filter(Boolean);
      const res2 = await recheckComprasMx(urls);
      console.log("\n--- RESULTADOS MODO 2 ---");
      console.log(JSON.stringify(res2, null, 2));
    }
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

run();
