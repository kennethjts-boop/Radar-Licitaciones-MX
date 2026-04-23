import { readFileSync } from "fs";
import pdf from "pdf-parse";
import { createModuleLogger } from "../core/logger";

const log = createModuleLogger("pdf-util");

const DEFAULT_MAX_PAGES = 40;
const DEFAULT_MAX_CHARS = 120_000;
const PDF_PARSE_TIMEOUT_MS = 30_000;

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
    const parsed = await Promise.race([
      pdf(fileBuffer, { max: maxPages }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`PDF parse timeout after ${PDF_PARSE_TIMEOUT_MS}ms`)),
          PDF_PARSE_TIMEOUT_MS,
        ),
      ),
    ]);

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

function estimateTokenCount(text: string): number {
  const clean = text.trim();
  if (!clean) {
    return 0;
  }

  // Heurística simple para español/inglés: ~4 caracteres por token.
  return Math.ceil(clean.length / 4);
}

function splitIntoSemanticBlocks(text: string): string[] {
  // Prioridad: párrafos (doble salto de línea) para evitar cortar ideas.
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphs.length > 1) {
    return paragraphs;
  }

  // Fallback: líneas individuales.
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    return lines;
  }

  return [text.trim()].filter(Boolean);
}

function splitOversizedBlock(block: string, maxTokens: number): string[] {
  if (estimateTokenCount(block) <= maxTokens) {
    return [block];
  }

  const words = block.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let currentWords: string[] = [];

  for (const word of words) {
    const nextCandidate = [...currentWords, word].join(" ");
    if (
      currentWords.length > 0 &&
      estimateTokenCount(nextCandidate) > maxTokens
    ) {
      chunks.push(currentWords.join(" "));
      currentWords = [word];
      continue;
    }
    currentWords.push(word);
  }

  if (currentWords.length > 0) {
    chunks.push(currentWords.join(" "));
  }

  return chunks;
}

export function chunkText(
  text: string,
  maxTokens = 800,
  overlap = 150,
): string[] {
  const cleanText = text.trim();
  if (!cleanText) {
    return [];
  }

  const safeMaxTokens = Math.max(1, maxTokens);
  const safeOverlap = Math.max(0, Math.min(overlap, safeMaxTokens - 1));

  const semanticBlocks = splitIntoSemanticBlocks(cleanText).flatMap((block) =>
    splitOversizedBlock(block, safeMaxTokens),
  );

  if (semanticBlocks.length === 0) {
    return [];
  }

  const output: string[] = [];
  let currentChunk = "";

  for (const block of semanticBlocks) {
    const separator = currentChunk ? "\n\n" : "";
    const candidate = `${currentChunk}${separator}${block}`;

    if (
      currentChunk &&
      estimateTokenCount(candidate) > safeMaxTokens
    ) {
      output.push(currentChunk);

      if (safeOverlap > 0) {
        const tailWords = currentChunk.split(/\s+/).filter(Boolean);
        const overlapWords: string[] = [];

        for (let i = tailWords.length - 1; i >= 0; i--) {
          const nextWords = [tailWords[i], ...overlapWords];
          if (estimateTokenCount(nextWords.join(" ")) > safeOverlap) {
            break;
          }
          overlapWords.unshift(tailWords[i]);
        }

        currentChunk = overlapWords.join(" ");
        currentChunk = currentChunk
          ? `${currentChunk}\n\n${block}`.trim()
          : block;
      } else {
        currentChunk = block;
      }

      continue;
    }

    currentChunk = candidate;
  }

  if (currentChunk) {
    output.push(currentChunk);
  }

  return output;
}
