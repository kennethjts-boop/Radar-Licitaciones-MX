/**
 * Conciliación acotada de los focos de prioridad (BIRMEX, DIFEM, JCEM, Salud).
 *
 * Re-evalúa en BD los expedientes de estos organismos, sin importar cuándo se
 * publicaron ni si el colector los saltó por no haber cambiado:
 *  - guarda siempre el match (incluido "monto por verificar");
 *  - encola UNA alerta sólo si el presupuesto oficial confirmado cumple el
 *    umbral del radar, el expediente sigue abierto y nunca generó alerta;
 *  - cuando un "monto por verificar" se confirma después (procurements.amount),
 *    la siguiente corrida lo promueve a alerta.
 * Idempotente (dedupe_key por expediente) y con tope por corrida. BIRMEX se
 * procesa primero. `dryRun` no escribe nada.
 */
import { getSupabaseClient } from "../../storage/client";
import { createModuleLogger } from "../../core/logger";
import { evaluateAllRadars } from "../../matchers/matcher";
import { enrichMatch } from "../../enrichers/match.enricher";
import { getActiveRadars } from "../../radars/index";
import { EDOMEX_FOCUS_KEYS, isPriorityFocusKey, isProcurementOpenForAlert } from "../../radars/edomex-focus.matcher";
import { resolveOfficialBudget, type ResolvedBudget } from "./budget-resolver";
import { ensurePendingNewTenderAlert, upsertMatch } from "../../storage/match-alert.repo";
import type { DbProcurement } from "../../types/database";
import type { NormalizedProcurement } from "../../types/procurement";

const log = createModuleLogger("priority-reconcile");

const ORGANISM_FILTER = [
  "dependency_name.ilike.%birmex%",
  "dependency_name.ilike.%biológicos y reactivos%",
  "dependency_name.ilike.%biologicos y reactivos%",
  "buying_unit.ilike.%012NEF001%",
  "dependency_name.ilike.%DIFEM%",
  "dependency_name.ilike.%Desarrollo Integral de la Familia del Estado%",
  "dependency_name.ilike.%Junta de Caminos%",
  "dependency_name.ilike.%JCEM%",
  "dependency_name.ilike.%Instituto de Salud del Estado%",
  "dependency_name.ilike.%ISEM%",
  "dependency_name.ilike.%Secretaría de Salud del Estado%",
  "dependency_name.ilike.%Secretaria de Salud del Estado%",
].join(",");

export interface ReconcileCandidate {
  licitationNumber: string | null;
  radarKey: string;
  amount: number | null;
  status: string;
  openingDate: string | null;
  outcome:
    | "amount_to_verify"
    | "amount_confirmed_from_document"
    | "queued"
    | "would_queue"
    | "already_alerted"
    | "closed_or_expired"
    | "cap_reached";
}

export interface ReconcileResult {
  dryRun: boolean;
  scanned: number;
  matched: number;
  toVerify: number;
  queued: number;
  alreadyAlerted: number;
  closedOrExpired: number;
  budgetsResolved: number;
  budgetLookups: number;
  candidates: ReconcileCandidate[];
}

export interface ReconcileOptions {
  dryRun?: boolean;
  maxQueue?: number;
  limit?: number;
  /** Máximo de expedientes abiertos «por verificar» cuyos documentos se leen por corrida. */
  maxBudgetLookups?: number;
  /** Inyectable en pruebas. */
  resolveBudget?: (input: Parameters<typeof resolveOfficialBudget>[0]) => Promise<ResolvedBudget | null>;
}

type Row = DbProcurement & { sources?: { key?: string } | Array<{ key?: string }> | null };

function toNormalized(row: Row, dbRowToNormalized: (row: DbProcurement) => NormalizedProcurement): NormalizedProcurement {
  const item = dbRowToNormalized(row);
  const source = Array.isArray(row.sources) ? row.sources[0]?.key : row.sources?.key;
  return source ? ({ ...item, source } as unknown as NormalizedProcurement) : item;
}

export async function reconcilePriorityOpportunities(
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const dryRun = options.dryRun === true;
  const maxQueue = options.maxQueue ?? 5;
  const db = getSupabaseClient();
  const { dbRowToNormalized } = await import("../../jobs/collect.job");
  const radars = getActiveRadars().filter((radar) => isPriorityFocusKey(radar.key));
  const result: ReconcileResult = {
    dryRun, scanned: 0, matched: 0, toVerify: 0, queued: 0, alreadyAlerted: 0, closedOrExpired: 0, budgetsResolved: 0, budgetLookups: 0, candidates: [],
  };
  if (radars.length === 0) return result;

  const { data: radarRows, error: radarError } = await db.from("radars").select("id,key,is_active")
    .in("key", radars.map((radar) => radar.key));
  if (radarError) throw new Error(`Radares de prioridad: ${radarError.message}`);
  const radarDbIds = new Map((radarRows ?? []).filter((r) => r.is_active).map((r) => [r.key as string, r.id as string]));

  const { data, error } = await db.from("procurements").select("*, sources(key)")
    .or(ORGANISM_FILTER).order("created_at", { ascending: false }).limit(options.limit ?? 1000);
  if (error) throw new Error(`Conciliación de prioridad: ${error.message}`);
  const rows = (data ?? []) as Row[];
  result.scanned = rows.length;

  const ids = rows.map((row) => row.id);
  const alerted = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data: alerts, error: alertError } = await db.from("alerts").select("dedupe_key")
      .in("dedupe_key", slice.map((id) => `new_match:${id}`));
    if (alertError) throw new Error(`Alertas existentes: ${alertError.message}`);
    for (const alert of alerts ?? []) alerted.add(String(alert.dedupe_key));
  }

  const evaluate = (list: Row[]) => list.flatMap((row) => {
    const item = toNormalized(row, dbRowToNormalized);
    return evaluateAllRadars(item, radars, false, null).map((match) => ({ row, item, match }));
  });
  const birmexFirst = <T extends { match: { radarKey: string } }>(list: T[]) =>
    list.sort((a, b) => Number(b.match.radarKey === EDOMEX_FOCUS_KEYS.birmex) - Number(a.match.radarKey === EDOMEX_FOCUS_KEYS.birmex));

  // Ruta de confirmación: «monto por verificar» abiertos → leer detalle/bases/anexos oficiales.
  const resolveBudget = options.resolveBudget ?? resolveOfficialBudget;
  const maxLookups = options.maxBudgetLookups ?? 3;
  const resolved = new Map<string, ResolvedBudget>();
  for (const { row, match } of birmexFirst(evaluate(rows))) {
    if (match.matchLevel === "high" || row.amount || resolved.has(row.id)) continue;
    if (!isProcurementOpenForAlert(row.status, row.opening_date)) continue;
    if (result.budgetLookups >= maxLookups) break;
    result.budgetLookups++;
    try {
      const budget = options.dryRun
        ? null
        : await resolveBudget({ procurementId: row.id, source: toNormalized(row, dbRowToNormalized).source,
            sourceUrl: row.source_url, procedureNumber: row.procedure_number, expedienteId: row.expediente_id });
      if (budget) {
        resolved.set(row.id, budget);
        row.amount = budget.amount;
        result.budgetsResolved++;
      }
    } catch (err) {
      log.warn({ err, procurementId: row.id }, "No se pudo confirmar el presupuesto desde documentos oficiales");
    }
  }
  const evaluated = birmexFirst(evaluate(rows));

  for (const { row, item, match } of evaluated) {
    result.matched++;
    const radarDbId = radarDbIds.get(match.radarKey);
    const base = { licitationNumber: row.licitation_number, radarKey: match.radarKey, amount: row.amount,
      status: row.status, openingDate: row.opening_date };
    const confirmed = match.matchLevel === "high";
    if (!dryRun && radarDbId) await upsertMatch({ ...match, procurementId: row.id }, radarDbId);

    if (!confirmed) {
      result.toVerify++;
      result.candidates.push({ ...base, outcome: "amount_to_verify" });
      continue;
    }
    if (resolved.has(row.id)) result.candidates.push({ ...base, outcome: "amount_confirmed_from_document" });
    if (alerted.has(`new_match:${row.id}`)) {
      result.alreadyAlerted++;
      result.candidates.push({ ...base, outcome: "already_alerted" });
      continue;
    }
    if (!isProcurementOpenForAlert(row.status, row.opening_date)) {
      result.closedOrExpired++;
      result.candidates.push({ ...base, outcome: "closed_or_expired" });
      continue;
    }
    if (result.queued >= maxQueue) {
      result.candidates.push({ ...base, outcome: "cap_reached" });
      continue;
    }
    if (dryRun) {
      result.queued++;
      result.candidates.push({ ...base, outcome: "would_queue" });
      continue;
    }
    if (!radarDbId) continue;
    const enriched = await enrichMatch(item, { ...match, procurementId: row.id }, undefined, []);
    const queued = await ensurePendingNewTenderAlert(enriched, row.id, radarDbId);
    if (queued.created) {
      result.queued++;
      result.candidates.push({ ...base, outcome: "queued" });
    }
  }
  log.info({ ...result, candidates: result.candidates.length }, "Conciliación de focos de prioridad");
  return result;
}
