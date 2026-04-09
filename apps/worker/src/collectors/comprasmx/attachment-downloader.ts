import path from "path";
import { Page } from "playwright";
import { createModuleLogger } from "../../core/logger";
import { SELECTORS } from "./comprasmx.navigator";

const log = createModuleLogger("comprasmx-attachments");

export interface DownloadedAttachment {
  fileName: string;
  tempFilePath: string;
  fileType: string | null;
}

function inferFileType(fileName: string): string | null {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".zip") return "application/zip";
  if (ext === ".doc") return "application/msword";
  if (ext === ".docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return null;
}

function normalizeFileName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function downloadAttachments(
  page: Page,
  tenderId: string,
  existingFileNames: Set<string>,
): Promise<DownloadedAttachment[]> {
  const table = page
    .locator("table")
    .filter({ has: page.getByText(SELECTORS.ATTACHMENTS_TABLE_HEADER) })
    .first();

  if ((await table.count()) === 0) {
    return [];
  }

  const rows = table.locator("tbody tr");
  const rowCount = await rows.count();
  const downloaded: DownloadedAttachment[] = [];
  const seenInRun = new Set<string>();

  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const description = (
      (await row.locator("td").nth(2).textContent()) ?? `adjunto_${i + 1}`
    ).trim();
    const action = row.locator("td").nth(4).locator("a,button").first();
    if ((await action.count()) === 0) continue;

    const baseName = normalizeFileName(description) || `adjunto_${i + 1}`;
    let uniqueName = baseName;
    let duplicateCounter = 1;
    while (
      existingFileNames.has(uniqueName) ||
      seenInRun.has(uniqueName) ||
      downloaded.find((x) => x.fileName === uniqueName)
    ) {
      duplicateCounter++;
      uniqueName = `${baseName}_${Date.now()}_${duplicateCounter}`;
    }

    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const downloadPromise = page.waitForEvent("download", {
          timeout: 30_000,
        });
        await action.click({ timeout: 30_000 });
        const download = await downloadPromise;
        const tempFilePath = await download.path();

        if (!tempFilePath) {
          throw new Error("Playwright no devolvió ruta temporal del archivo.");
        }

        const suggested = normalizeFileName(download.suggestedFilename());
        const finalFileName =
          path.extname(uniqueName) || !path.extname(suggested)
            ? uniqueName
            : `${uniqueName}${path.extname(suggested)}`;

        downloaded.push({
          fileName: finalFileName,
          tempFilePath,
          fileType: inferFileType(finalFileName),
        });
        seenInRun.add(finalFileName);
        success = true;
        break;
      } catch (err) {
        log.warn(
          { err, tenderId, fileName: uniqueName, attempt },
          "Fallo descargando adjunto, reintentando",
        );
        if (attempt < 3) {
          const jitterMs = Math.floor(Math.random() * 2000) + 1000;
          await page.waitForTimeout(jitterMs);
        }
      }
    }

    if (!success) {
      log.error(
        { tenderId, fileName: uniqueName },
        "No se pudo descargar adjunto tras 3 intentos",
      );
    }
  }

  return downloaded;
}
