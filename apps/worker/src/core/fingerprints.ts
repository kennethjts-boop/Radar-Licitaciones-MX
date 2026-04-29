/**
 * FINGERPRINTS — Hash determinista para deduplicación.
 * SHA-256 sobre texto canónico normalizado.
 */
import crypto from "crypto";
import { normalizeText } from "./text";

/**
 * Genera SHA-256 hex de un string.
 */
export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Fingerprint de expediente: title + description + dependency + buying_unit.
 * Normalizar texto antes de hashear para evitar diferencias triviales.
 */
export function buildProcurementFingerprint(params: {
  title: string;
  description?: string | null;
  dependencyName?: string | null;
  buyingUnit?: string | null;
  expedienteId?: string | null;
}): string {
  const parts = [
    params.expedienteId ?? "",
    params.title,
    params.description ?? "",
    params.dependencyName ?? "",
    params.buyingUnit ?? "",
  ];
  const canonical = normalizeText(parts.join("|"));
  return sha256(canonical);
}

/**
 * Fingerprint de versión: status + dates + amount + source_url.
 * Captura cambios relevantes sin ser sensible a whitespace o capitalización.
 */
export function buildVersionFingerprint(params: {
  status: string;
  title: string;
  description?: string | null;
  publicationDate?: string | null;
  openingDate?: string | null;
  amount?: number | null;
  sourceUrl: string;
  licitationNumber?: string | null;
}): string {
  const parts = [
    params.status,
    params.title,
    params.description ?? "",
    params.publicationDate ?? "",
    params.openingDate ?? "",
    String(params.amount ?? ""),
    params.licitationNumber ?? "",
    params.sourceUrl,
  ];
  const canonical = normalizeText(parts.join("|"));
  return sha256(canonical);
}

/**
 * Fingerprint de adjunto: URL + nombre de archivo.
 */
export function buildAttachmentFingerprint(
  fileUrl: string,
  fileName: string,
): string {
  return sha256(`${fileName}|${fileUrl}`);
}

/**
 * Fingerprint de raw_json para detectar cambios en el objeto crudo.
 */
export function buildRawFingerprint(raw: Record<string, unknown>): string {
  const serialized = JSON.stringify(raw, Object.keys(raw).sort());
  return sha256(serialized);
}

/**
 * Hash canónico de deduplicación cross-ID: número de procedimiento + expediente_id.
 * Estable incluso si ComprasMX cambia su external_id interno.
 */
export function buildCanonicalHash(
  numeroProcedimiento: string | null | undefined,
  expedienteId: string | null | undefined,
): string {
  const parts = [
    (numeroProcedimiento ?? "").trim().toLowerCase(),
    (expedienteId ?? "").trim().toLowerCase(),
  ];
  return sha256(parts.join("|"));
}

/**
 * Detecta qué campos cambiaron entre dos objetos parciales.
 * Retorna un objeto con { campo: { prev, next } } para cada campo diferente.
 */
export function detectChangedFields(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, { prev: unknown; next: unknown }> {
  const changed: Record<string, { prev: unknown; next: unknown }> = {};
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);

  for (const key of allKeys) {
    const pVal = prev[key] ?? null;
    const nVal = next[key] ?? null;
    if (JSON.stringify(pVal) !== JSON.stringify(nVal)) {
      changed[key] = { prev: pVal, next: nVal };
    }
  }

  return changed;
}
