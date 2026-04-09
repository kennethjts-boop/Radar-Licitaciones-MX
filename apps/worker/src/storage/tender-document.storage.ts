import { createReadStream, existsSync, statSync, unlinkSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { getConfig } from "../config/env";
import { getSupabaseClient } from "./client";

export interface UploadedTenderFile {
  fileName: string;
  storagePath: string;
  fileSizeBytes: number;
  fileHash: string;
}

function sanitizeFileName(fileName: string): string {
  return fileName
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildStoragePath(tenderId: string, fileName: string): string {
  const cleaned = sanitizeFileName(path.basename(fileName));
  return `${tenderId}/${cleaned || "documento_sin_nombre.bin"}`;
}

async function computeFileHash(tempFilePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(tempFilePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export async function uploadTenderFile(
  tenderId: string,
  fileName: string,
  tempFilePath: string,
  fileType: string | null,
): Promise<UploadedTenderFile> {
  const db = getSupabaseClient();
  const config = getConfig();
  const storagePath = buildStoragePath(tenderId, fileName);

  try {
    const stream = createReadStream(tempFilePath);
    const { error } = await db.storage
      .from(config.SUPABASE_TENDER_DOCUMENTS_BUCKET)
      .upload(storagePath, stream, {
        contentType: fileType ?? undefined,
        upsert: false,
      });

    if (error) {
      throw new Error(error.message);
    }

    const fileSizeBytes = statSync(tempFilePath).size;
    const fileHash = await computeFileHash(tempFilePath);

    console.log(
      JSON.stringify({
        event: "UPLOAD_SUCCESS",
        tenderId,
        file: fileName,
        storagePath,
        size: fileSizeBytes,
      }),
    );

    return { fileName, storagePath, fileSizeBytes, fileHash };
  } finally {
    if (existsSync(tempFilePath)) {
      unlinkSync(tempFilePath);
    }
  }
}
