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
  /** Evita releer el portal del mismo expediente en cada ciclo (inyectable en pruebas). */
  budgetLookupGuard?: BudgetLookupGuard;
  /** Inyectable en pruebas. */
  resolveBudget?: (input: Parameters<typeof resolveOfficialBudget>[0]) => Promise<ResolvedBudget | null>;
}

type Row = DbProcurement & { sources?: { key?: string } | Array<{ key?: string }> | null };

function toNormalized(row: Row, dbRowToNormalized: (row: DbProcurement) => NormalizedProcurement): NormalizedProcurement {
  const item = dbRowToNormalized(row);
  const source = Array.isArray(row.sources) ? row.sources[0]?.key : row.sources?.key;
  // La primera detección real del radar es la fecha de alta del expediente, no la de esta alerta.
  const withDetection = { ...item, rawJson: { ...item.rawJson, primera_deteccion: row.created_at } };
  return source ? ({ ...withDetection, source } as unknown as NormalizedProcurement) : withDetection;
}

/** Reintento de lectura del presupuesto de un mismo expediente: como máximo cada 6 h. */
const LOOKUP_RETRY_MS = 6 * 60 * 60 * 1000;

export interface BudgetLookupGuard {
  shouldLookup(procurementId: string): Promise<boolean>;
  record(procurementId: string): Promise<void>;
}

const defaultLookupGuard: BudgetLookupGuard = {
  async shouldLookup(procurementId) {
    try {
      const { data } = await getSupabaseClient().from("system_state").select("value_json")
        .eq("key", `priority_budget_lookup:${procurementId}`).maybeSingle();
      const at = (data?.value_json as { at?: string } | null)?.at;
      return !at || Date.now() - Date.parse(at) >= LOOKUP_RETRY_MS;
    } catch {
      return true; // sin estado legible no se bloquea la consulta
    }
  },
  async record(procurementId) {
    try {
      await getSupabaseClient().from("system_state").upsert({
        key: `priority_budget_lookup:${procurementId}`, value_json: { at: new Date().toISOString() }, updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    } catch { /* el siguiente ciclo vuelve a consultar */ }
  },
};

const BIRMEX_ROW = /birmex|biol[oó]gicos y reactivos|012NEF001/i;
function isBirmexRow(row: Row): boolean {
  return BIRMEX_ROW.test(`${row.dependency_name ?? ""} ${row.buying_unit ?? ""} ${row.licitation_number ?? ""}`);
}
function birmexFirstRows(list: Row[]): Row[] {
  const unique = [...new Map(list.map((row) => [row.id, row])).values()];
  return unique.sort((a, b) => Number(isBirmexRow(b)) - Number(isBirmexRow(a)));
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
  // Candidatos: «monto por verificar» abiertos y, para BIRMEX (prioridad máxima), cualquier
  // expediente abierto sin monto aunque el título no diga «consolidada»: ComprasMX publica el
  // presupuesto por partida en el detalle y el listado no lo trae.
  const matchedIds = new Set<string>();
  const candidates: Row[] = [];
  for (const { row, match } of birmexFirst(evaluate(rows))) {
    matchedIds.add(row.id);
    if (match.matchLevel !== "high" && !row.amount) candidates.push(row);
  }
  const birmexUnmatched = rows.filter((row) => !matchedIds.has(row.id) && !row.amount && isBirmexRow(row));
  const lookups = options.budgetLookupGuard ?? defaultLookupGuard;
  for (const row of birmexFirstRows([...candidates, ...birmexUnmatched])) {
    if (resolved.has(row.id) || !isProcurementOpenForAlert(row.status, row.opening_date)) continue;
    if (result.budgetLookups >= maxLookups) break;
    if (!options.dryRun && !(await lookups.shouldLookup(row.id))) continue;
    result.budgetLookups++;
    try {
      const budget = options.dryRun
        ? null
        : await resolveBudget({ procurementId: row.id, source: toNormalized(row, dbRowToNormalized).source,
            sourceUrl: row.source_url, procedureNumber: row.procedure_number, expedienteId: row.expediente_id });
      if (!options.dryRun) await lookups.record(row.id);
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
