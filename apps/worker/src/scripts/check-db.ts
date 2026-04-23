import { getSupabaseClient } from "../storage/client";
import { createModuleLogger } from "../core/logger";

const log = createModuleLogger("check-db");

async function check() {
  const db = getSupabaseClient();
  
  const { data: apuestas, error: errA } = await db.from("inv_apuestas").select("*").order("detectado_at", { ascending: false }).limit(5);
  console.log("--- Ultimas 5 Apuestas ---");
  console.log(JSON.stringify(apuestas, null, 2));
  
  const { data: procurements, error: errP } = await db.from("procurements").select("id, title, dependency_name").ilike("dependency_name", "%capufe%").limit(5);
  console.log("--- Ultimas 5 CAPUFE ---");
  console.log(JSON.stringify(procurements, null, 2));
}

check().catch(console.error);
