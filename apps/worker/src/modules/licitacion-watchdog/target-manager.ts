import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { getSupabaseClient } from "../../storage/client";
import {
  resolveTargetUuid,
  handleResolutionFailure,
  buildExpedienteUrl,
  type WatchdogTarget,
  type ResolvedTarget,
} from "./target-resolver";

const log = createModuleLogger("licitacion-watchdog:target-manager");

interface WatchdogTargetRow {
  id: string;
  procurement_id: string;
  procedure_number: string;
  comprasmx_uuid: string;
  alias: string;
  dependency: string | null;
  active: boolean;
  activated_at: string;
  deactivated_at: string | null;
  last_checked_at: string | null;
  last_snapshot_id: string | null;
}

export interface PersistentWatchdogTarget extends ResolvedTarget {
  procurementId: string;
  dependency: string | null;
  active: boolean;
  activatedAt: string;
  deactivatedAt: string | null;
  lastCheckedAt: string | null;
  lastSnapshotId: string | null;
}

function rowToTarget(row: WatchdogTargetRow): PersistentWatchdogTarget {
  return {
    id: row.id,
    procurementId: row.procurement_id,
    alias: row.alias,
    numero: row.procedure_number,
    uuid: row.comprasmx_uuid,
    expedienteUrl: buildExpedienteUrl(row.comprasmx_uuid),
    dependency: row.dependency,
    active: row.active,
    activatedAt: row.activated_at,
    deactivatedAt: row.deactivated_at,
    lastCheckedAt: row.last_checked_at,
    lastSnapshotId: row.last_snapshot_id,
  };
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(
    error &&
      (error.code === "42P01" ||
        error.code === "PGRST205" ||
        message.includes("could not find the table") ||
        message.includes("relation \"public.watchdog_targets\" does not exist")),
  );
}

export async function listPersistentTargets(
  activeOnly = false,
): Promise<PersistentWatchdogTarget[] | null> {
  let query = getSupabaseClient().from("watchdog_targets").select("*");
  if (activeOnly) query = query.eq("active", true);
  const { data, error } = await query.order("activated_at", { ascending: true });
  if (isMissingTableError(error)) return null;
  if (error) throw new Error(`No se pudieron leer targets watchdog: ${error.message}`);
  return ((data ?? []) as WatchdogTargetRow[]).map(rowToTarget);
}

/** Retrocompatibilidad de arranque durante el despliegue anterior a la migración. */
export function getStaticTargets(): WatchdogTarget[] {
  const config = getConfig();
  if (config.WATCHDOG_TARGETS?.trim()) {
    try {
      const parsed = JSON.parse(config.WATCHDOG_TARGETS) as Array<Record<string, string>>;
      if (Array.isArray(parsed)) {
        return parsed.map((item, index) => ({
          id: item.id || `legacy-${index + 1}`,
          alias: item.alias || item.numero || `Target ${index + 1}`,
          numero: item.numero || item.numeroProcedimiento,
          uuid: item.uuid || null,
        }));
      }
    } catch (err) {
      log.warn({ err }, "WATCHDOG_TARGETS inválido; se usa fallback legacy");
    }
  }
  return config.WATCHDOG_EXPEDIENTES.split(",")
    .map((numero) => numero.trim())
    .filter(Boolean)
    .map((numero) => ({
      id: numero === "LA-09-J0U-009J0U001-N-68-2026" ? "capufe-n68" : `legacy-${numero}`,
      alias: numero === "LA-09-J0U-009J0U001-N-68-2026" ? "CAPUFE · N-68" : numero,
      numero,
      uuid:
        numero === "LA-09-J0U-009J0U001-N-68-2026"
          ? "1daccbec8b4b4c4aba85c8793886a1bf"
          : null,
    }));
}

export async function getDynamicTargets(): Promise<WatchdogTarget[]> {
  return (await listPersistentTargets(false)) ?? [];
}

export async function getAllTargets(): Promise<WatchdogTarget[]> {
  const persisted = await listPersistentTargets(true);
  return persisted ?? getStaticTargets();
}

export async function getResolvedTargets(): Promise<ResolvedTarget[]> {
  const targets = await getAllTargets();
  const resolved: ResolvedTarget[] = [];
  for (const target of targets) {
    const uuid = await resolveTargetUuid(target);
    if (uuid) {
      resolved.push({ ...target, uuid, expedienteUrl: buildExpedienteUrl(uuid) });
    } else {
      await handleResolutionFailure(target);
    }
  }
  return resolved;
}

async function findProcurement(idOrProcedure: string) {
  const db = getSupabaseClient();
  const fields =
    "id, external_id, procedure_number, licitation_number, title, dependency_name, source_url";
  const byId = await db.from("procurements").select(fields).eq("id", idOrProcedure).maybeSingle();
  if (!byId.error && byId.data) return byId.data;

  const byProcedure = await db
    .from("procurements")
    .select(fields)
    .or(
      `external_id.eq.${idOrProcedure},procedure_number.eq.${idOrProcedure},licitation_number.eq.${idOrProcedure}`,
    )
    .limit(1)
    .maybeSingle();
  if (byProcedure.error) {
    throw new Error(`No se pudo consultar la licitación: ${byProcedure.error.message}`);
  }
  return byProcedure.data;
}

export async function activateWatchdogTarget(
  procurementIdOrProcedure: string,
  alias?: string,
): Promise<PersistentWatchdogTarget> {
  const clean = procurementIdOrProcedure.trim();
  const procurement = await findProcurement(clean);
  if (!procurement) throw new Error(`La licitación ${clean} no está registrada`);

  const procedureNumber =
    procurement.procedure_number || procurement.licitation_number || procurement.external_id;
  const uuid = String(procurement.source_url ?? "").match(
    /\/detalle\/([^/]+)\/procedimiento/i,
  )?.[1];
  if (!procedureNumber || !uuid) {
    throw new Error("La licitación no tiene número/UUID ComprasMX utilizable");
  }

  const existingTarget = (await listPersistentTargets(false))?.find(
    (target) => target.procurementId === procurement.id,
  );
  const activatedAt = nowISO();
  const { data, error } = await getSupabaseClient()
    .from("watchdog_targets")
    .upsert(
      {
        procurement_id: procurement.id,
        procedure_number: procedureNumber,
        comprasmx_uuid: uuid,
        alias:
          alias?.trim() ||
          existingTarget?.alias ||
          `${procurement.dependency_name || "Licitación"} · ${procedureNumber}`,
        dependency: procurement.dependency_name,
        active: true,
        activated_at: activatedAt,
        deactivated_at: null,
        updated_at: activatedAt,
      },
      { onConflict: "procurement_id" },
    )
    .select("*")
    .single();
  if (error) throw new Error(`No se pudo activar watchdog: ${error.message}`);
  log.info({ procurementId: procurement.id, procedureNumber }, "Target watchdog activo");
  return rowToTarget(data as WatchdogTargetRow);
}

export async function deactivateWatchdogTarget(idOrProcedure: string): Promise<boolean> {
  const clean = idOrProcedure.trim();
  const targets = await listPersistentTargets(false);
  if (!targets) throw new Error("La migración watchdog_targets aún no está aplicada");
  const target = targets.find(
    (candidate) =>
      candidate.id === clean ||
      candidate.procurementId === clean ||
      candidate.numero.toLowerCase() === clean.toLowerCase(),
  );
  if (!target) return false;
  if (!target.active) return true;

  const timestamp = nowISO();
  const { error } = await getSupabaseClient()
    .from("watchdog_targets")
    .update({ active: false, deactivated_at: timestamp, updated_at: timestamp })
    .eq("id", target.id);
  if (error) throw new Error(`No se pudo desactivar watchdog: ${error.message}`);
  log.info({ targetId: target.id, procedureNumber: target.numero }, "Target watchdog inactivo; historia conservada");
  return true;
}

export async function updateTargetCheck(input: {
  targetId: string;
  snapshotId?: string;
}): Promise<void> {
  const timestamp = nowISO();
  const update: Record<string, string> = {
    last_checked_at: timestamp,
    updated_at: timestamp,
  };
  if (input.snapshotId) update.last_snapshot_id = input.snapshotId;
  const { error } = await getSupabaseClient()
    .from("watchdog_targets")
    .update(update)
    .eq("id", input.targetId);
  if (error) log.warn({ error, targetId: input.targetId }, "No se actualizó telemetría del target");
}

// Nombres históricos conservados para comandos existentes.
export const addDynamicTarget = activateWatchdogTarget;
export const removeDynamicTarget = deactivateWatchdogTarget;
