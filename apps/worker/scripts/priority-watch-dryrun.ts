/**
 * Lectura real, de solo lectura y con tiempo límite, de los dos folios vigilados. No usa Supabase
 * ni Telegram: estado y bandeja en memoria; imprime la lectura inicial y el calendario resultante.
 * Uso: npx ts-node scripts/priority-watch-dryrun.ts
 */
import { runPriorityWatch, type RunnerDeps } from "../src/modules/priority-watch/runner";
import { captureFromUrl } from "../src/modules/priority-watch/source";
import { emptyState, type WatchState } from "../src/modules/priority-watch/store";
import { WATCHED_PROCEDURES, type OutboxEntry } from "../src/modules/priority-watch/types";

const URLS: Record<string, string> = {
  "LA-12-NEF-012NEF001-N-306-2026": "https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/4d8532fd8b77462aa7da2b73afb236b5/procedimiento",
  "LA-12-NEF-012NEF001-N-3-2027": "https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/8d0517be786f4f878c109c5d861226ce/procedimiento",
};

async function main(): Promise<void> {
  const states = new Map<string, WatchState>();
  const outboxes = new Map<string, OutboxEntry[]>();
  const deps: RunnerDeps = {
    capture: (w) => captureFromUrl(URLS[w.procedure]),
    state: { load: async (p) => states.get(p) ?? emptyState(), save: async (p, s) => { states.set(p, s); } },
    outbox: { load: async (p) => outboxes.get(p) ?? [], save: async (p, e) => { outboxes.set(p, e); } },
    send: async () => { throw new Error("dry-run: no se envía a Telegram"); },
    procurementId: async () => null, now: () => new Date(),
  };
  const results = await runPriorityWatch(deps, WATCHED_PROCEDURES);
  for (const r of results) console.log(JSON.stringify({ procedure: r.procedure, status: r.status, checked: r.checked, error: r.error, coverage: r.partidasCoverage }));
  for (const [procedure, state] of states) {
    console.log(`\n# ${procedure}`);
    console.log(JSON.stringify(state.initialReport, null, 1));
    console.log("pendientes:", state.pendingVerification);
    const b = state.baseline!;
    console.log("calendario:", JSON.stringify(Object.fromEntries(Object.entries(b.calendar.milestones).map(([k, v]) => [k, v.at]))));
    console.log("documentos:", b.documents.map((d) => `${d.category}:${d.createdAt}`).join(", "));
    console.log("partidas:", b.partidas.length, "completas:", b.partidasComplete, "destacadas:", b.partidas.filter((p) => p.highlighted).map((p) => p.descripcion));
  }
}
void main();
