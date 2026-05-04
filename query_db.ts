import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: 'apps/worker/.env' });
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function run() {
  const { data: alerts, error: errA } = await db.from('alerts').select('*').order('created_at', { ascending: false }).limit(5);
  console.log("Recent Alerts:", errA ? errA : alerts);
  const { data: matches, error: errM } = await db.from('matches').select('*').order('created_at', { ascending: false }).limit(5);
  console.log("Recent Matches:", errM ? errM : matches);
  const { data: procs, error: errP } = await db.from('procurements').select('id, external_id, title, status, opening_date, created_at').order('created_at', { ascending: false }).limit(5);
  console.log("Recent Procurements:", errP ? errP : procs);
}
run();
