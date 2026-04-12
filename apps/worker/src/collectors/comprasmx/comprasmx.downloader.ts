import path from "path";
import type { Page } from "playwright";
import { createModuleLogger } from "../../core/logger";
import { toErrorMessage, withRetries } from "../../utils/retry.util";

const log = createModuleLogger("comprasmx-downloader");

export interface DownloadedAttachment {
  fileName: string;
  tempFilePath: string;
}

export interface DownloadAttachmentsOptions {
  timeoutMs?: number;
  procurementId?: string;
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
  const procurementId = options.procurementId ?? "unknown";
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

      const downloaded = await withRetries(
        async (attempt) => {
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

          return { fileName, tempFilePath, attempt };
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1_000,
          backoffMultiplier: 2,
          onRetry: async (error, attempt, delayMs) => {
            log.warn(
              {
                event: "DOWNLOAD_RETRY",
                attempt,
                procurementId,
                fileName: fallbackName,
                delayMs,
                error: toErrorMessage(error),
              },
              "Reintentando descarga de adjunto",
            );
          },
        },
      );

      results.push({ fileName: downloaded.fileName, tempFilePath: downloaded.tempFilePath });
      log.info(
        {
          event: "DOWNLOAD_COMPLETED",
          attempt: downloaded.attempt,
          procurementId,
          fileName: downloaded.fileName,
          tempFilePath: downloaded.tempFilePath,
        },
        "Descarga de adjunto completada",
      );
    } catch (err) {
      log.warn(
        {
          event: "DOWNLOAD_FAILED",
          attempt: 3,
          procurementId,
          fileName: `adjunto_${i + 1}`,
          timeoutMs,
          error: toErrorMessage(err),
        },
        "Falló descarga de adjunto; se continúa con el siguiente",
      );
      continue;
    }
  }

  return results;
}
