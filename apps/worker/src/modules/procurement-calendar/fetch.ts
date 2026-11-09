/**
 * Lectura del calendario oficial con el navegador del colector de ComprasMX.
 * El detalle del expediente trae los cuatro hitos y la lista de anexos
 * (avisos de suspensión/diferimiento y acta de fallo).
 */
import { BrowserManager } from "../../collectors/comprasmx/browser.manager";
import type { ComprasMxDetailData } from "./extract";

export async function fetchComprasMxDetailData(detailUrl: string): Promise<ComprasMxDetailData> {
  return BrowserManager.withContext(async (page) => {
    let detail: ComprasMxDetailData | null = null;
    page.on("response", async (response) => {
      if (response.status() !== 200 || !/\/expedientes\/[0-9a-f]{32}\?/.test(response.url())) return;
      try {
        const body = (await response.json()) as { data?: ComprasMxDetailData };
        if (body.data?.registro?.length) detail = body.data;
      } catch { /* respuesta no JSON */ }
    });
    await page.goto(detailUrl, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(4_000);
    if (!detail) throw new Error("El portal no devolvió el detalle del expediente");
    return detail;
  }, { timeoutMs: 120_000 });
}
