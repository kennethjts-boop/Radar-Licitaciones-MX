import path from "path";
import type { Page } from "playwright";
import { createModuleLogger } from "../../core/logger";

const log = createModuleLogger("comprasmx-downloader");

export interface DownloadedAttachment {
  fileName: string;
  tempFilePath: string;
}

export interface DownloadAttachmentsOptions {
  timeoutMs?: number;
}

const ATTACHMENT_TRIGGER_SELECTOR = [
  'a:has-text("Descargar")',
  'a:has-text("Bases")',
  'a:has-text("Anexo")',
  'a:has-text("PDF")',
  'a:has-text("ZIP")',
  'button:has-text("Descargar")',
  'button:has-text("Bases")',
  'button:has-text("Anexo")',
  'button:has-text("PDF")',
  'button:has-text("ZIP")',
].join(", ");

function normalizeFileName(fileName: string): string {
  return fileName
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function ensureExtension(baseName: string, suggestedName: string): string {
  const ext = path.extname(baseName);
  if (ext) return baseName;

  const suggestedExt = path.extname(suggestedName);
  return suggestedExt ? `${baseName}${suggestedExt}` : baseName;
}

/**
 * Descarga adjuntos desde una página de detalle ya abierta.
 * Si un archivo falla, se registra warn y se continúa con el siguiente.
 */
export async function downloadAttachmentsFromDetail(
  page: Page,
  options: DownloadAttachmentsOptions = {},
): Promise<DownloadedAttachment[]> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const triggers = page.locator(ATTACHMENT_TRIGGER_SELECTOR);
  const total = await triggers.count();
  const results: DownloadedAttachment[] = [];

  if (total === 0) {
    log.info("No se detectaron controles de descarga en el detalle");
    return results;
  }

  for (let i = 0; i < total; i++) {
    const trigger = triggers.nth(i);

    try {
      const label = ((await trigger.innerText().catch(() => "")) || "").trim();
      const fallbackName = normalizeFileName(label) || `adjunto_${i + 1}`;

      const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs });
      await trigger.click({ timeout: timeoutMs });
      const download = await downloadPromise;

      const tempFilePath = await download.path();
      if (!tempFilePath) {
        throw new Error("Playwright no devolvió tempFilePath del archivo");
      }

      const suggestedName =
        normalizeFileName(download.suggestedFilename()) || `adjunto_${i + 1}`;
      const fileName = ensureExtension(fallbackName, suggestedName);

      results.push({ fileName, tempFilePath });
      log.info({ fileName, tempFilePath }, "Descarga de adjunto completada");
    } catch (err) {
      log.warn(
        { err, index: i, timeoutMs },
        "Falló descarga de adjunto; se continúa con el siguiente",
      );
      continue;
    }
  }

  return results;
}
