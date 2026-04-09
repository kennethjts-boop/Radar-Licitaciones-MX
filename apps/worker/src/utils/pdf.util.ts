import { readFileSync } from "fs";
import pdf from "pdf-parse";
import { createModuleLogger } from "../core/logger";

const log = createModuleLogger("pdf-util");

const DEFAULT_MAX_PAGES = 40;
const DEFAULT_MAX_CHARS = 120_000;

export interface ExtractPdfTextOptions {
  maxPages?: number;
  maxChars?: number;
}

/**
 * Extrae texto plano desde un PDF local usando pdf-parse.
 * Incluye guardrails para evitar picos de memoria/tokens con documentos gigantes.
 */
export async function extractTextFromPdf(
  tempFilePath: string,
  options: ExtractPdfTextOptions = {},
): Promise<string> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  try {
    const fileBuffer = readFileSync(tempFilePath);
    const parsed = await pdf(fileBuffer, { max: maxPages });

    const rawText = (parsed.text ?? "").trim();
    if (!rawText) {
      return "";
    }

    if (rawText.length > maxChars) {
      log.info(
        { tempFilePath, maxPages, maxChars, extractedChars: rawText.length },
        "Texto de PDF truncado por guardrail de caracteres",
      );
      return rawText.slice(0, maxChars);
    }

    return rawText;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message, tempFilePath }, "Fallo extrayendo texto de PDF");
    throw new Error(`No se pudo extraer texto del PDF: ${message}`);
  }
}
