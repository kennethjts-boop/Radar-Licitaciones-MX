/**
 * Captura de solo lectura desde Compras MX con el navegador del colector.
 * Busca el procedimiento por número y expediente aunque ya no figure en el listado
 * de abiertos (usa el UUID guardado en la fila del procedimiento o, si falta, la API
 * firmada del colector).
 */
import { BrowserManager } from "../../collectors/comprasmx/browser.manager";
import { searchComprasMxProcedimientos, apiRegistroToRawInput } from "../../collectors/comprasmx/comprasmx.navigator";
import { getSupabaseClient } from "../../storage/client";
import type { PortalCapture } from "./snapshot";
import type { WatchedProcedure } from "./types";

const DETAIL_BASE = "https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle";
const CAPTURE_TIMEOUT_MS = 120_000;

export async function resolveDetailUrl(watched: WatchedProcedure): Promise<string> {
  const { data } = await getSupabaseClient().from("procurements").select("source_url")
    .or(`licitation_number.eq.${watched.procedure},expediente_id.eq.${watched.expediente}`).limit(1).maybeSingle();
  const stored = (data?.source_url as string | undefined) ?? "";
  if (/\/detalle\/[0-9a-f]{32}\/procedimiento/i.test(stored)) return stored;
  const found = await searchComprasMxProcedimientos({ numero_procedimiento: watched.procedure }, 1);
  const match = found.registros.find((item) => item.numero_procedimiento === watched.procedure);
  if (!match?.uuid_procedimiento) throw new Error(`No se pudo ubicar el UUID de ${watched.procedure} en Compras MX`);
  return apiRegistroToRawInput(match).sourceUrl || `${DETAIL_BASE}/${match.uuid_procedimiento}/procedimiento`;
}

export async function capturePortal(watched: WatchedProcedure): Promise<PortalCapture> {
  return captureFromUrl(await resolveDetailUrl(watched));
}

/** Lectura de solo lectura del detalle de un expediente a partir de su URL oficial. */
export async function captureFromUrl(officialUrl: string): Promise<PortalCapture> {
  return BrowserManager.withContext(async (page) => {
    let detail: PortalCapture["detail"] | null = null;
    let reqeconomicos: unknown;
    let anexosApi: unknown;
    page.on("response", async (response) => {
      if (response.status() !== 200) return;
      const url = response.url();
      try {
        if (/\/expedientes\/[0-9a-f]{32}\/reqeconomicos\?/.test(url)) reqeconomicos ??= await response.json();
        else if (/\/expedientes\/[0-9a-f]{32}\/anexos\?/.test(url)) anexosApi ??= await response.json();
        else if (/\/expedientes\/[0-9a-f]{32}\?/.test(url)) {
          const body = (await response.json()) as { data?: PortalCapture["detail"] };
          if (body.data?.registro?.length) detail = body.data;
        }
      } catch { /* respuesta no JSON */ }
    });
    await page.goto(officialUrl, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(4_000);
    if (!detail) throw new Error("El portal no devolvió el detalle del expediente");
    return { detail, reqeconomicos, anexosApi, capturedAt: new Date().toISOString(), officialUrl };
  }, { timeoutMs: CAPTURE_TIMEOUT_MS });
}
