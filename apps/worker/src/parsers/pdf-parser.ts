/**
 * PDF PARSER — Extrae texto de un PDF local usando pdf.util.extractTextFromPdf.
 * Devuelve ParseResult con needs_ocr si el texto es muy corto (probable PDF escaneado).
 */
import { extractTextFromPdf } from "../utils/pdf.util";
import type { ParseResult } from "./types";

const MIN_TEXT_LENGTH_FOR_OK = 50;

export async function parsePdf(localPath: string): Promise<ParseResult> {
  try {
    const text = await extractTextFromPdf(localPath);
    if (!text) {
      return { text: "", parseStatus: "empty", errors: [] };
    }
    if (text.length < MIN_TEXT_LENGTH_FOR_OK) {
      return { text, parseStatus: "needs_ocr", errors: [] };
    }
    return { text, parseStatus: "ok", errors: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: "", parseStatus: "error", errors: [msg] };
  }
}
