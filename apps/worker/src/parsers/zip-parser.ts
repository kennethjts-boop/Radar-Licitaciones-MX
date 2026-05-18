/**
 * ZIP PARSER — Descomprime y parsea archivos PDF/DOCX/XLSX dentro de un ZIP.
 * Límites: máximo 50 archivos, 100 MB total descomprimido. No parsea ZIPs anidados.
 * Continúa si un archivo individual falla.
 */
import AdmZip from "adm-zip";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import { createModuleLogger } from "../core/logger";
import type { ParseResult, ZipEntry, ZipParseResult } from "./types";
import { parseXlsxBuffer } from "./xlsx-parser";

const log = createModuleLogger("zip-parser");

const MAX_ZIP_FILES = 50;
const MAX_ZIP_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MB

const PARSEABLE_EXTENSIONS = new Set(["pdf", "docx", "doc", "xlsx", "xls"]);

function getExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

async function parseEntryBuffer(ext: string, buffer: Buffer): Promise<ParseResult> {
  if (ext === "pdf") {
    const parsed = await pdf(buffer);
    const text = (parsed.text ?? "").trim();
    return { text, parseStatus: text ? "ok" : "empty", errors: [] };
  }
  if (ext === "docx" || ext === "doc") {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    return { text, parseStatus: text ? "ok" : "empty", errors: [] };
  }
  if (ext === "xlsx") {
    return parseXlsxBuffer(buffer);
  }
  if (ext === "xls") {
    return {
      text: "",
      parseStatus: "error",
      errors: ["formato .xls no soportado por el parser seguro"],
    };
  }
  return { text: "", parseStatus: "error", errors: [`extensión no soportada: ${ext}`] };
}

export async function parseZip(localPath: string): Promise<ZipParseResult> {
  const errors: string[] = [];
  const files: ZipEntry[] = [];

  try {
    const zip = new AdmZip(localPath);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);

    // Límite de archivos
    if (entries.length > MAX_ZIP_FILES) {
      errors.push(`ZIP excede el límite de ${MAX_ZIP_FILES} archivos (${entries.length} encontrados)`);
    }

    let totalBytes = 0;
    let stopped = false;

    for (const entry of entries) {
      if (stopped) break;

      const ext = getExtension(entry.entryName);

      // Saltar no-parseables (incluyendo ZIPs anidados)
      if (!PARSEABLE_EXTENSIONS.has(ext)) continue;

      // Límite de tamaño acumulado
      totalBytes += entry.header.size;
      if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
        errors.push(`ZIP excede el límite de 100 MB descomprimido`);
        stopped = true;
        break;
      }

      // Parsear entry
      try {
        const buffer = entry.getData();
        const parseResult = await parseEntryBuffer(ext, buffer);
        files.push({ fileName: entry.entryName, fileType: ext, parseResult });
      } catch (entryErr) {
        const msg = entryErr instanceof Error ? entryErr.message : String(entryErr);
        log.warn({ entryName: entry.entryName, err: msg }, "Error parseando entrada de ZIP");
        errors.push(`${entry.entryName}: ${msg}`);
        files.push({ fileName: entry.entryName, fileType: ext, parseResult: null });
      }
    }

    // Determinar status
    let parseStatus: ZipParseResult["parseStatus"];
    const parsed = files.filter((f) => f.parseResult !== null);
    if (files.length === 0) {
      parseStatus = "empty";
    } else if (parsed.length === files.length && errors.length === 0) {
      parseStatus = "ok";
    } else if (parsed.length > 0) {
      parseStatus = "partial";
    } else {
      parseStatus = "error";
    }

    return { files, parseStatus, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { files: [], parseStatus: "error", errors: [msg] };
  }
}
