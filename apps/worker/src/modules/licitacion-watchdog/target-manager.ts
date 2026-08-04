import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import { getState, setState } from "../../core/system-state";
import {
  resolveTargetUuid,
  handleResolutionFailure,
  buildExpedienteUrl,
  type WatchdogTarget,
  type ResolvedTarget,
} from "./target-resolver";

const log = createModuleLogger("licitacion-watchdog:target-manager");
const DYNAMIC_TARGETS_STATE_KEY = "watchdog_dynamic_targets";

export function getStaticTargets(): WatchdogTarget[] {
  const config = getConfig();
  if (config.WATCHDOG_TARGETS && config.WATCHDOG_TARGETS.trim().length > 0) {
    try {
      const parsed = JSON.parse(config.WATCHDOG_TARGETS);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item: any, idx: number) => ({
          id: item.id || `target-${idx + 1}`,
          alias: item.alias || item.numero || `Target ${idx + 1}`,
          numero: item.numero || item.numeroProcedimiento,
          uuid: item.uuid || null,
        }));
      }
    } catch (err) {
      log.warn({ err }, "No se pudo parsear WATCHDOG_TARGETS como JSON; usando WATCHDOG_EXPEDIENTES fallback");
    }
  }

  // Retrocompatibilidad: si WATCHDOG_TARGETS no existe o falló, usar WATCHDOG_EXPEDIENTES
  const expedientes = config.WATCHDOG_EXPEDIENTES.split(",").map((v) => v.trim()).filter(Boolean);
  return expedientes.map((numero) => {
    if (numero === "LA-09-J0U-009J0U001-N-68-2026") {
      return {
        id: "capufe-n68",
        alias: "CAPUFE · N-68",
        numero,
        uuid: "1daccbec8b4b4c4aba85c8793886a1bf",
      };
    }
    return {
      id: `exp-${numero.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`,
      alias: numero,
      numero,
      uuid: null,
    };
  });
}

export async function getDynamicTargets(): Promise<WatchdogTarget[]> {
  const stored = await getState<WatchdogTarget[]>(DYNAMIC_TARGETS_STATE_KEY as any);
  return Array.isArray(stored) ? stored : [];
}

export async function getAllTargets(): Promise<WatchdogTarget[]> {
  const staticTargets = getStaticTargets();
  const dynamicTargets = await getDynamicTargets();

  const targetMap = new Map<string, WatchdogTarget>();
  for (const target of staticTargets) {
    targetMap.set(target.numero, target);
  }
  for (const target of dynamicTargets) {
    targetMap.set(target.numero, target);
  }

  return Array.from(targetMap.values());
}

/**
 * Resuelve y retorna todos los targets con UUID activo
 */
export async function getResolvedTargets(): Promise<ResolvedTarget[]> {
  const targets = await getAllTargets();
  const resolvedList: ResolvedTarget[] = [];

  for (const target of targets) {
    const uuid = await resolveTargetUuid(target);
    if (uuid) {
      resolvedList.push({
        ...target,
        uuid,
        expedienteUrl: buildExpedienteUrl(uuid),
      });
    } else {
      await handleResolutionFailure(target);
    }
  }

  return resolvedList;
}

/**
 * Alta en caliente de un nuevo procedimiento (/vigilar <numero>)
 */
export async function addDynamicTarget(numero: string, alias?: string): Promise<ResolvedTarget> {
  const cleanNumero = numero.trim();
  const target: WatchdogTarget = {
    id: `custom-${cleanNumero.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`,
    alias: alias || cleanNumero,
    numero: cleanNumero,
    uuid: null,
  };

  const uuid = await resolveTargetUuid(target);
  if (!uuid) {
    throw new Error(`No se pudo resolver el UUID para el procedimiento ${cleanNumero}`);
  }

  target.uuid = uuid;
  const dynamicTargets = await getDynamicTargets();
  const existingIdx = dynamicTargets.findIndex((t) => t.numero === cleanNumero);
  if (existingIdx >= 0) {
    dynamicTargets[existingIdx] = target;
  } else {
    dynamicTargets.push(target);
  }

  await setState(DYNAMIC_TARGETS_STATE_KEY as any, dynamicTargets as any);
  log.info({ numero: cleanNumero, uuid }, "Nuevo target agregado dinámicamente");

  return {
    ...target,
    uuid,
    expedienteUrl: buildExpedienteUrl(uuid),
  };
}

/**
 * Baja de un procedimiento vigilar (/novigilar <id_o_numero>)
 */
export async function removeDynamicTarget(idOrNumero: string): Promise<boolean> {
  const query = idOrNumero.trim().toLowerCase();
  const dynamicTargets = await getDynamicTargets();
  const filtered = dynamicTargets.filter(
    (t) => t.id.toLowerCase() !== query && t.numero.toLowerCase() !== query,
  );

  if (filtered.length !== dynamicTargets.length) {
    await setState(DYNAMIC_TARGETS_STATE_KEY as any, filtered as any);
    log.info({ query }, "Target eliminado de monitoreo dinámico");
    return true;
  }

  return false;
}
