import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: 'apps/worker/.env' });
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function run() {
  const { data, error } = await db.from('scrape_maestros_progress').select('*').order('updated_at', { ascending: false }).limit(1);
  if (error) console.error(error);
  else console.log(JSON.stringify(data?.[0]?.maestros_json?.length));
}
run();
