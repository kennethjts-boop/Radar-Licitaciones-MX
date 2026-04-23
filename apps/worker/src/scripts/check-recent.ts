import { getSupabaseClient } from "../storage/client";
async function check() {
  const db = getSupabaseClient();
  const { data, error } = await db.from("procurements").select("id, title, dependency_name, publication_date, created_at").order("created_at", { ascending: false }).limit(10);
  if (error) console.error(error);
  else console.log(JSON.stringify(data, null, 2));
}
check().catch(console.error);
