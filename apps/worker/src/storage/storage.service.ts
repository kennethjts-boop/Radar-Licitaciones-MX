import { createReadStream, existsSync, statSync, unlinkSync } from "fs";
import { basename } from "path";
import { createHash } from "crypto";
import { createModuleLogger } from "../core/logger";
import { getSupabaseClient } from "./client";
import { toErrorMessage, withRetries } from "../utils/retry.util";

const log = createModuleLogger("storage-service");

export interface UploadedAttachment {
  storagePath: string;
  fileSizeBytes: number;
  fileHash: string;
}

async function calculateFileHash(tempFilePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(tempFilePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Sube un archivo temporal a Supabase Storage y SIEMPRE limpia /tmp al terminar.
 *
 * Ruta en bucket (estricta): ${procurementId}/${fileName}
 */
export async function uploadAttachment(
  procurementId: string,
  fileName: string,
  tempFilePath: string,
): Promise<UploadedAttachment> {
  const db = getSupabaseClient();
  const safeFileName = basename(fileName);
  const storagePath = `${procurementId}/${safeFileName}`;

  try {
    await withRetries(
      async (attempt) => {
        const stream = createReadStream(tempFilePath);
        const { error } = await db.storage
          .from("tender-documents")
          .upload(storagePath, stream, {
            upsert: false,
          });

        if (error) {
          throw new Error(error.message);
        }

        log.debug(
          {
            event: "STORAGE_UPLOAD_SUCCESS",
            attempt,
            procurementId,
            fileName: safeFileName,
            storagePath,
          },
          "Upload de adjunto completado en intento",
        );
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1_000,
        backoffMultiplier: 2,
        onRetry: async (error, attempt, delayMs) => {
          log.warn(
            {
              event: "STORAGE_UPLOAD_RETRY",
              attempt,
              procurementId,
              fileName: safeFileName,
              storagePath,
              delayMs,
              error: toErrorMessage(error),
            },
            "Reintentando upload de adjunto",
          );
        },
      },
    );

    const fileSizeBytes = statSync(tempFilePath).size;
    const fileHash = await calculateFileHash(tempFilePath);
    log.info(
      {
        procurementId,
        fileName: safeFileName,
        storagePath,
        fileSizeBytes,
        fileHash,
      },
      "Adjunto subido a Storage",
    );

    return { storagePath, fileSizeBytes, fileHash };
  } catch (err) {
    log.error(
      {
        event: "STORAGE_UPLOAD_FAILED",
        attempt: 3,
        procurementId,
        fileName: safeFileName,
        storagePath,
        tempFilePath,
        error: toErrorMessage(err),
      },
      "Error subiendo adjunto a Storage",
    );
    throw err;
  } finally {
    try {
      if (existsSync(tempFilePath)) {
        unlinkSync(tempFilePath);
        log.debug({ tempFilePath }, "Archivo temporal eliminado");
      }
    } catch (cleanupErr) {
      log.warn(
        { err: cleanupErr, tempFilePath },
        "No se pudo eliminar archivo temporal",
      );
    }
  }
}
