import axios from "axios";
import { nowISO } from "../core/time";
import {
  collectComprasMxDetail,
  type DocumentLink,
} from "../collectors/comprasmx-detail";
import { persistTenderDocuments } from "../storage/tender-documents.repo";
import type { PublicTenderDocument } from "../types/procurement";

const VALIDATION_TIMEOUT_MS = 12_000;
const VALIDATION_SAMPLE_BYTES = 4096;
const MAX_DOCUMENTS_PER_ALERT = 12;
const DOWNLOADABLE_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "zip", "rar"]);
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface PublicDocumentValidation {
  ok: boolean;
  mimeType: string | null;
  fileSize: number | null;
  reason: string | null;
}

export interface PreparePublicTenderDocumentsInput {
  tenderId: string;
  sourceUrl: string;
  procedureNumber: string | null;
  expedienteId: string | null;
  scope: string;
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function fileExtensionFromName(fileName: string | null, url: string): string | null {
  const source = fileName ?? url.split("?")[0].split("/").pop() ?? "";
  const ext = source.split(".").pop()?.toLowerCase() ?? "";
  return ext.length > 0 && ext.length <= 5 ? ext : null;
}

function stableDocumentName(doc: DocumentLink, index: number): string {
  const title = doc.documentTitle?.trim();
  if (title && !/^descargar$/i.test(title)) return title;
  if (doc.documentHint !== "otro") return doc.documentHint.replace(/_/g, " ");
  return doc.fileName ?? `Documento ${index + 1}`;
}

function isProbablyDownloadable(doc: DocumentLink): boolean {
  const ext = fileExtensionFromName(doc.fileName, doc.fileUrl);
  return doc.isDownloadable || Boolean(ext && DOWNLOADABLE_EXTENSIONS.has(ext));
}

function isHtmlLike(contentType: string | null, buffer?: Buffer): boolean {
  if (contentType?.toLowerCase().includes("text/html")) return true;
  if (!buffer) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 200)).toString("utf8").toLowerCase();
  return sample.includes("<html") || sample.includes("<!doctype html");
}

function isExpectedDownloadContent(
  url: string,
  contentType: string | null,
  buffer?: Buffer,
): boolean {
  const lowerType = contentType?.toLowerCase() ?? "";
  const lowerUrl = url.toLowerCase();
  if (isHtmlLike(contentType, buffer)) return false;
  if (lowerType.includes("application/pdf")) return true;
  if (lowerType.includes("application/zip")) return true;
  if (lowerType.includes("officedocument")) return true;
  if (lowerType.includes("application/octet-stream")) return true;
  return /\.(pdf|docx?|xlsx?|zip)(\?|$)/i.test(lowerUrl);
}

function isStrongHeadDownloadContent(contentType: string | null): boolean {
  const lowerType = contentType?.toLowerCase() ?? "";
  if (lowerType.includes("text/html")) return false;
  return (
    lowerType.includes("application/pdf") ||
    lowerType.includes("application/zip") ||
    lowerType.includes("officedocument")
  );
}

export async function validatePublicDocumentUrl(url: string): Promise<PublicDocumentValidation> {
  try {
    const head = await axios
      .head(url, {
        timeout: VALIDATION_TIMEOUT_MS,
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: { "User-Agent": USER_AGENT },
      })
      .catch(() => null);

    const headContentType = head?.headers?.["content-type"]
      ? String(head.headers["content-type"])
      : null;
    const headLength = head?.headers?.["content-length"]
      ? Number(head.headers["content-length"])
      : null;

    if (
      head &&
      head.status === 200 &&
      Number.isFinite(headLength) &&
      Number(headLength) <= 0
    ) {
      return {
        ok: false,
        mimeType: headContentType,
        fileSize: Number(headLength),
        reason: "empty_file",
      };
    }

    if (head && isStrongHeadDownloadContent(headContentType)) {
      return {
        ok: true,
        mimeType: headContentType,
        fileSize: Number.isFinite(headLength) ? Number(headLength) : null,
        reason: null,
      };
    }

    const get = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: VALIDATION_TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        "User-Agent": USER_AGENT,
        Range: `bytes=0-${VALIDATION_SAMPLE_BYTES - 1}`,
      },
    });
    const buffer = Buffer.from(get.data);
    const contentType = get.headers?.["content-type"]
      ? String(get.headers["content-type"])
      : headContentType;
    const contentLength = get.headers?.["content-length"]
      ? Number(get.headers["content-length"])
      : buffer.length;

    if (buffer.length === 0) {
      return { ok: false, mimeType: contentType, fileSize: 0, reason: "empty_file" };
    }
    if (!isExpectedDownloadContent(url, contentType, buffer)) {
      return {
        ok: false,
        mimeType: contentType,
        fileSize: Number.isFinite(contentLength) ? Number(contentLength) : buffer.length,
        reason: "not_download_content",
      };
    }

    return {
      ok: true,
      mimeType: contentType,
      fileSize: Number.isFinite(contentLength) ? Number(contentLength) : buffer.length,
      reason: null,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, mimeType: null, fileSize: null, reason };
  }
}

function dedupeDocumentLinks(docs: DocumentLink[]): DocumentLink[] {
  const seen = new Set<string>();
  const result: DocumentLink[] = [];

  for (const doc of docs) {
    const key = normalizeUrl(doc.fileUrl).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(doc);
  }

  return result;
}

function toPublicTenderDocument(input: {
  doc: DocumentLink;
  index: number;
  publicUrl: string;
  validation: PublicDocumentValidation;
  sha256Hash: string | null;
  fileSizeOverride?: number | null;
}): PublicTenderDocument {
  const checkedAt = nowISO();
  const extension = fileExtensionFromName(input.doc.fileName, input.doc.fileUrl);
  return {
    documentName: stableDocumentName(input.doc, input.index),
    documentType: input.doc.documentHint,
    originalUrl: input.doc.fileUrl,
    publicUrl: input.publicUrl,
    mimeType: input.validation.mimeType,
    fileExtension: extension ?? input.doc.fileType,
    fileSize: input.fileSizeOverride ?? input.validation.fileSize,
    sha256Hash: input.sha256Hash,
    detectedAt: input.doc.discoveredAt,
    lastCheckedAt: checkedAt,
    isAvailable: true,
    source: input.doc.source,
  };
}

export async function preparePublicTenderDocuments(
  input: PreparePublicTenderDocumentsInput,
): Promise<PublicTenderDocument[]> {
  const detail = await collectComprasMxDetail({
    sourceUrl: input.sourceUrl,
    procedureNumber: input.procedureNumber,
    expedienteId: input.expedienteId,
    scope: input.scope,
  });

  if (detail.documents.length === 0) {
    return [];
  }

  const docs = dedupeDocumentLinks(detail.documents)
    .filter((doc) => isProbablyDownloadable(doc) || doc.documentTitle.trim().length > 0)
    .slice(0, MAX_DOCUMENTS_PER_ALERT);
  const prepared: PublicTenderDocument[] = [];
  const auditRecords = [];

  for (const [index, doc] of docs.entries()) {
    const publicDoc = toPublicTenderDocument({
      doc,
      index,
      publicUrl: doc.fileUrl,
      validation: {
        ok: true,
        mimeType: null,
        fileSize: null,
        reason: null,
      },
      sha256Hash: null,
    });
    prepared.push(publicDoc);
    auditRecords.push({
      tenderId: input.tenderId,
      expediente: input.expedienteId,
      licitacionId: input.procedureNumber,
      document: publicDoc,
      discardReason: null,
    });
  }

  await persistTenderDocuments(auditRecords);
  return prepared;
}
