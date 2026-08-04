import { getSupabaseClient } from "../storage/client";

async function check() {
  const db = getSupabaseClient();
  
  console.log("\n=== SEARCHING FOR N-29 TENDERS IN DB ===");
  const { data: results, error: err } = await db
    .from('procurements')
    .select('id, external_id, procedure_number, licitation_number, title, dependency_name, source_url')
    .or('procedure_number.ilike.%N-29%,licitation_number.ilike.%N-29%,procedure_number.ilike.%29-2026%,licitation_number.ilike.%29-2026%,procedure_number.ilike.%998%,licitation_number.ilike.%998%');

  if (err) {
    console.error("Error searching specific N-29 procurements:", err);
  } else {
    console.log(JSON.stringify(results, null, 2));
  }

  console.log("\n=== WATCHDOG SNAPSHOTS ===");
  const { data: snapshots, error: snapErr } = await db
    .from('watchdog_snapshots')
    .select('id, numero_procedimiento, created_at, snapshot_hash')
    .order('created_at', { ascending: false })
    .limit(10);

  if (snapErr) {
    console.error("Error fetching snapshots:", snapErr);
  } else {
    console.log(JSON.stringify(snapshots, null, 2));
  }

  console.log("\n=== PROCUREMENTS FOR WATCHDOG PROCEDURES ===");
  if (snapshots && snapshots.length > 0) {
    const procedureNumbers = Array.from(new Set(snapshots.map(s => s.numero_procedimiento)));
    for (const num of procedureNumbers) {
      const { data: procs, error: procErr } = await db
        .from('procurements')
        .select('id, external_id, procedure_number, licitation_number, title, source_url')
        .or(`external_id.eq.${num},procedure_number.eq.${num},licitation_number.eq.${num}`);
      
      if (procErr) {
        console.error(`Error fetching procurements for ${num}:`, procErr);
      } else {
        console.log(`For ${num}:`, JSON.stringify(procs, null, 2));
      }
    }
  }

  console.log("\n=== ALL SNAPSHOTS AND DETECTED CHANGES ===");
  const { data: allSnapshots, error: allErr } = await db
    .from('watchdog_snapshots')
    .select('id, numero_procedimiento, created_at, detected_changes')
    .eq('numero_procedimiento', 'LA-09-J0U-009J0U001-N-68-2026')
    .order('created_at', { ascending: false });

  if (allErr) {
    console.error("Error fetching all snapshots:", allErr);
  } else if (allSnapshots) {
    for (const snap of allSnapshots) {
      console.log(`Snapshot ID: ${snap.id} | Created: ${snap.created_at}`);
      console.log("Notification status:", snap.detected_changes?.notification);
      console.log("Changes (count):", snap.detected_changes?.changes?.length);
      console.log("Changes:", JSON.stringify(snap.detected_changes?.changes, null, 2));
      console.log("-----------------------------------------");
    }
  }
}

check().catch(console.error);
