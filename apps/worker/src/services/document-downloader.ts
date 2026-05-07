/**
 * DOCUMENT DOWNLOADER — Descarga documentos públicos de licitaciones.
 * Guarda en /tmp/radar-docs/{sha256}.{ext}, deduplica por hash.
 * Nunca hace throw al caller — errores en `downloadStatus` + `errorMessage`.
 */
import axios from "axios";
import * as fs from "fs";
import { createHash } from "crypto";
import { createModuleLogger } from "../core/logger";
import { nowISO } from "../core/time";
import type { DocumentLink } from "../collectors/comprasmx-detail/index";

const log = createModuleLogger("document-downloader");

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const DOWNLOAD_TIMEOUT_MS = 30_000;
const HEAD_TIMEOUT_MS = 10_000;
const RATE_LIMIT_MS = 2_000;
const DOWNLOAD_DIR = "/tmp/radar-docs";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DOWNLOADABLE_TYPES = new Set(["pdf", "docx", "xlsx", "zip"]);

export interface DownloadResult {
  fileUrl: string;
  fileName: string;
  fileType: string;
  sha256Hash: string | null;
  downloadStatus: "ok" | "skipped_duplicate" | "failed" | "too_large";
  sizeBytes: number | null;
  localPath: string | null;
  errorMessage: string | null;
  downloadedAt: string;
}

function ensureDownloadDir(): void {
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }
}

export async function downloadDocument(doc: DocumentLink): Promise<DownloadResult> {
  const base: DownloadResult = {
    fileUrl: doc.fileUrl,
    fileName: doc.fileName ?? doc.fileUrl.split("/").pop() ?? "file",
    fileType: doc.fileType,
    sha256Hash: null,
    downloadStatus: "failed",
    sizeBytes: null,
    localPath: null,
    errorMessage: null,
    downloadedAt: nowISO(),
  };

  // 1. Validar tipo de archivo
  if (!DOWNLOADABLE_TYPES.has(doc.fileType)) {
    return {
      ...base,
      downloadStatus: "failed",
      errorMessage: `tipo no soportado: ${doc.fileType}`,
    };
  }

  try {
    // 2. HEAD request (best-effort) para verificar Content-Length antes de descargar
    const headResp = await axios
      .head(doc.fileUrl, {
        timeout: HEAD_TIMEOUT_MS,
        headers: { "User-Agent": USER_AGENT },
      })
      .catch(() => null);

    const clHeader = headResp?.headers?.["content-length"];
    if (clHeader) {
      const declaredSize = parseInt(String(clHeader), 10);
      if (!isNaN(declaredSize) && declaredSize > MAX_SIZE_BYTES) {
        return { ...base, downloadStatus: "too_large", sizeBytes: declaredSize };
      }
    }

    // 3. Descargar archivo completo
    const response = await axios.get<ArrayBuffer>(doc.fileUrl, {
      responseType: "arraybuffer",
      timeout: DOWNLOAD_TIMEOUT_MS,
      headers: { "User-Agent": USER_AGENT },
      maxRedirects: 5,
    });

    const buffer = Buffer.from(response.data);

    // 4. Verificar tamaño real
    if (buffer.length > MAX_SIZE_BYTES) {
      return { ...base, downloadStatus: "too_large", sizeBytes: buffer.length };
    }

    // 5. SHA256 + dedup
    const sha256Hash = createHash("sha256").update(buffer).digest("hex");
    const localPath = `${DOWNLOAD_DIR}/${sha256Hash}.${doc.fileType}`;

    ensureDownloadDir();

    if (fs.existsSync(localPath)) {
      return {
        ...base,
        downloadStatus: "skipped_duplicate",
        sha256Hash,
        sizeBytes: buffer.length,
        localPath,
      };
    }

    // 6. Escribir a disco
    fs.writeFileSync(localPath, buffer);

    log.info(
      { fileUrl: doc.fileUrl, sha256Hash, sizeBytes: buffer.length },
      "Documento descargado",
    );

    return {
      ...base,
      downloadStatus: "ok",
      sha256Hash,
      sizeBytes: buffer.length,
      localPath,
      errorMessage: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err, fileUrl: doc.fileUrl }, "Error descargando documento");
    return { ...base, downloadStatus: "failed", errorMessage: msg };
  }
}

export async function downloadDocuments(
  docs: DocumentLink[],
): Promise<DownloadResult[]> {
  const results: DownloadResult[] = [];
  const isTest = process.env.NODE_ENV === "test";

  for (const doc of docs) {
    const result = await downloadDocument(doc);
    results.push(result);

    // Rate limit between downloads — skipped in test environment to avoid slow tests.
    // In production, enforces 2s between requests to avoid hammering the server.
    if (!isTest && docs.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));
    }
  }

  return results;
}
