import { createReadStream, existsSync, statSync, unlinkSync } from "fs";
import { basename } from "path";
import { createModuleLogger } from "../core/logger";
import { getSupabaseClient } from "./client";

const log = createModuleLogger("storage-service");

export interface UploadedAttachment {
  storagePath: string;
  fileSizeBytes: number;
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
    const stream = createReadStream(tempFilePath);
    const { error } = await db.storage
      .from("tender-documents")
      .upload(storagePath, stream, {
        upsert: false,
      });

    if (error) {
      throw new Error(error.message);
    }

    const fileSizeBytes = statSync(tempFilePath).size;
    log.info(
      { procurementId, fileName: safeFileName, storagePath, fileSizeBytes },
      "Adjunto subido a Storage",
    );

    return { storagePath, fileSizeBytes };
  } catch (err) {
    log.error(
      { err, procurementId, fileName: safeFileName, tempFilePath },
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
