import { BrowserManager } from "../../collectors/comprasmx/browser.manager";
import { createModuleLogger } from "../../core/logger";
import { getState, setState } from "../../core/system-state";
import { getSupabaseClient } from "../../storage/client";
import { sendTelegramMessageWithReceipt } from "../../alerts/telegram.alerts";
import { extractWatchdogSnapshot } from "./extractor";
import type { WatchdogSnapshot } from "./types";

const log = createModuleLogger("licitacion-watchdog:target-resolver");

export interface WatchdogTarget {
  id: string;
  alias: string;
  numero: string;
  uuid: string | null;
  procurementId?: string;
  dependency?: string | null;
  active?: boolean;
}

export interface ResolvedTarget extends WatchdogTarget {
  uuid: string;
  expedienteUrl: string;
  isVerified?: boolean;
}

const FAILED_ATTEMPTS_STATE_KEY = "watchdog_resolution_failures";
const WARNED_TELEGRAM_STATE_KEY = "watchdog_resolution_warned";

export function buildExpedienteUrl(uuid: string): string {
  return `https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/${uuid}/procedimiento`;
}

/**
 * Intenta resolver el UUID de un número de procedimiento si este viene como null.
 * 1. Consulta el cache en system_state ("watchdog_uuid:{numero}")
 * 2. Consulta la tabla procurements en Supabase
 * 3. Busca en el buscador público de ComprasMX con Playwright
 */
export async function resolveTargetUuid(target: WatchdogTarget): Promise<string | null> {
  if (target.uuid && target.uuid.trim().length > 0) {
    return target.uuid.trim();
  }

  const cacheKey = `watchdog_uuid:${target.numero}` as any;
  const cached = await getState<any>(cacheKey);
  const cachedUuid = typeof cached === "string" ? cached : (cached?.uuid as string | undefined);
  if (cachedUuid && typeof cachedUuid === "string" && cachedUuid.trim().length > 0) {
    return cachedUuid.trim();
  }

  // 1. Probar en la BD Supabase (procurements)
  try {
    const db = getSupabaseClient();
    const { data } = await db
      .from("procurements")
      .select("source_url")
      .or(
        `external_id.eq.${target.numero},procedure_number.eq.${target.numero},licitation_number.eq.${target.numero}`,
      )
      .limit(1)
      .maybeSingle();

    const dbUrl = data?.source_url as string | undefined;
    const dbUuid = dbUrl?.match(/\/detalle\/([^/]+)\/procedimiento/i)?.[1];
    if (dbUuid) {
      log.info({ numero: target.numero, uuid: dbUuid }, "UUID resuelto desde tabla procurements");
      await setState(cacheKey, { uuid: dbUuid });
      return dbUuid;
    }
  } catch (err) {
    log.warn({ err, numero: target.numero }, "Error consultando DB para resolver UUID");
  }

  // 2. Probar mediante navegador público en ComprasMX (Buscador público)
  if (process.env.NODE_ENV === "test") {
    return null;
  }

  try {
    log.info({ numero: target.numero }, "Buscando expediente en buscador público ComprasMX via Playwright");
    const foundUuid = await BrowserManager.withContext(async (page) => {
      await page.goto("https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/busqueda", {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });

      const searchInput = page.locator("input[placeholder*='Buscar'], input[type='text']").first();
      await searchInput.waitFor({ timeout: 15_000 });
      await searchInput.fill(target.numero);
      await searchInput.press("Enter");

      const searchBtn = page.locator("button:has-text('Buscar'), button.p-button").first();
      if (await searchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchBtn.click().catch(() => {});
      }

      const detailLink = page.locator(`a[href*='/sitiopublico/detalle/']`).first();
      await detailLink.waitFor({ timeout: 15_000 });
      const href = await detailLink.getAttribute("href");
      const match = href?.match(/\/detalle\/([^/]+)\/procedimiento/i);
      return match ? match[1] : null;
    }, { timeoutMs: 90_000 });

    if (foundUuid) {
      log.info({ numero: target.numero, uuid: foundUuid }, "UUID resuelto exitosamente desde buscador ComprasMX");
      await setState(cacheKey, { uuid: foundUuid });
      return foundUuid;
    }
  } catch (err) {
    log.warn({ err, numero: target.numero }, "Fallo buscando UUID en buscador público ComprasMX");
  }

  return null;
}

/**
 * Manejo de fallos en la resolución de UUIDs (3 reintentos + Telegram único)
 */
export async function handleResolutionFailure(target: WatchdogTarget): Promise<void> {
  const failuresState = (await getState<Record<string, number>>(FAILED_ATTEMPTS_STATE_KEY as any)) || {};
  const currentFailures = (failuresState[target.numero] || 0) + 1;
  failuresState[target.numero] = currentFailures;
  await setState(FAILED_ATTEMPTS_STATE_KEY as any, failuresState as any);

  log.warn(
    { numero: target.numero, attempt: currentFailures },
    `Falló intento (${currentFailures}/3) para resolver UUID de ${target.numero}`,
  );

  if (currentFailures >= 3) {
    const warnedState = (await getState<Record<string, boolean>>(WARNED_TELEGRAM_STATE_KEY as any)) || {};
    if (!warnedState[target.numero]) {
      const text = `⚠️ <b>No pude ubicar el expediente <code>${target.numero}</code> en ComprasMX</b>\nSe mantendrá en reintentos pero el monitoreo continuará para el resto de los expedientes.`;
      try {
        await sendTelegramMessageWithReceipt(text, "HTML");
        warnedState[target.numero] = true;
        await setState(WARNED_TELEGRAM_STATE_KEY as any, warnedState as any);
      } catch (err) {
        log.warn({ err }, "No se pudo enviar aviso por Telegram de fallo en resolución de expediente");
      }
    }
  }
}

/**
 * Notifica a Telegram cuando un target presenta degrado en verificación de portal
 */
export async function notifyDegradedTarget(
  target: WatchdogTarget,
  reason: string,
  failedSelectors: string[],
): Promise<void> {
  const text = [
    `⚠️ <b>[TARGET DEGRADADO] Watchdog ${target.alias}</b>`,
    `Procedimiento: <code>${target.numero}</code>`,
    `Motivo: ${reason}`,
    failedSelectors.length > 0 ? `Selectores fallidos: <code>${failedSelectors.join(", ")}</code>` : "",
    "<i>El monitoreo continuará para los demás expedientes.</i>",
  ].filter(Boolean).join("\n");

  try {
    await sendTelegramMessageWithReceipt(text, "HTML");
  } catch (err) {
    log.warn({ err }, "No se pudo enviar notificación de target degradado por Telegram");
  }
}

/**
 * Verifica un snapshot contra los requerimientos de portal
 * ("Estatus del procedimiento de contratación" y "Número de procedimiento de contratación")
 */
export function verifySnapshotFields(snapshot: WatchdogSnapshot): {
  valid: boolean;
  reason?: string;
  failedSelectors?: string[];
} {
  if (snapshot.partial !== false || snapshot.extractionFailure) {
    return {
      valid: false,
      reason: snapshot.extractionFailure?.message || "Snapshot parcial devuelto",
      failedSelectors: [snapshot.extractionFailure?.stage || "detail_content"],
    };
  }

  const fields = snapshot.visibleFields || {};
  if (Object.keys(fields).length === 0 && snapshot.detail && Object.keys(snapshot.detail).length > 0) {
    return { valid: true };
  }

  const hasStatus = Boolean(fields["Estatus del procedimiento de contratación"]);
  const hasProcedureNumber = Boolean(fields["Número de procedimiento de contratación"]);

  const failedSelectors: string[] = [];
  if (!hasStatus) failedSelectors.push("label:Estatus del procedimiento de contratación");
  if (!hasProcedureNumber) failedSelectors.push("label:Número de procedimiento de contratación");

  if (failedSelectors.length > 0 && Object.keys(fields).length > 0) {
    return {
      valid: false,
      reason: "Campos requeridos de portal no encontrados en la extracción",
      failedSelectors,
    };
  }

  return { valid: true };
}
