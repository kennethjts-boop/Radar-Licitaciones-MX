/**
 * DOCX PARSER — Extrae texto plano de un DOCX usando mammoth.
 */
import mammoth from "mammoth";
import type { ParseResult } from "./types";

export async function parseDocx(localPath: string): Promise<ParseResult> {
  try {
    const result = await mammoth.extractRawText({ path: localPath });
    const text = result.value.trim();
    if (!text) {
      return { text: "", parseStatus: "empty", errors: [] };
    }
    return { text, parseStatus: "ok", errors: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: "", parseStatus: "error", errors: [msg] };
  }
}
