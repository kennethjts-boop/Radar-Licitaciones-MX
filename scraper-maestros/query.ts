import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '../apps/worker/.env' });
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function run() {
  const { data, error } = await db.from('scrape_maestros_progress').select('*');
  if (error) { console.error(error); return; }
  let best = [];
  for (const row of data || []) {
    if (row.maestros_json && row.maestros_json.length > best.length) {
      best = row.maestros_json;
    }
  }
  console.log("Total in DB:", best.length);
  require('fs').writeFileSync('maestros_db.json', JSON.stringify(best));
}
run();
