/**
 * NORMALIZER — Normalización de texto para matching de objetos de contratación.
 *
 * Palabras vacías en español para limpiar el texto antes de comparar.
 * Aislado del normalizer principal del radar.
 */

const STOP_WORDS = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas",
  "y", "o", "e", "ni", "pero", "mas", "sin", "con", "en", "a", "al",
  "para", "por", "sobre", "entre", "ante", "bajo", "hacia", "desde",
  "hasta", "que", "se", "su", "sus", "lo", "le", "les", "me", "te",
  "nos", "les", "era", "es", "son", "ser", "ha", "han", "hay",
  "no", "si", "ya", "como", "cuando", "donde", "cual", "cuales",
  "este", "esta", "estos", "estas", "ese", "esa", "esos", "esas",
  "aquel", "aquella", "aquellos", "aquellas",
]);

/**
 * Normaliza texto: minúsculas, sin acentos, sin puntuación, sin espacios múltiples.
 */
export function normalizeObjectText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // quitar diacríticos
    .replace(/[^a-z0-9\s]/g, " ")      // solo letras/números/espacios
    .replace(/\s+/g, " ")              // colapsar espacios
    .trim();
}

/**
 * Tokeniza y elimina stop words.
 * Retorna array de tokens significativos (≥ 3 chars).
 */
export function tokenizeObject(text: string): string[] {
  const normalized = normalizeObjectText(text);
  return normalized
    .split(" ")
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/**
 * Calcula el score de similitud de texto entre dos strings (Jaccard sobre tokens).
 * Retorna 0.0 – 1.0.
 */
export function textSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenizeObject(a));
  const tokensB = new Set(tokenizeObject(b));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  const intersection = [...tokensA].filter((t) => tokensB.has(t));
  const union = new Set([...tokensA, ...tokensB]);

  return intersection.length / union.size;
}

/**
 * Limpia un número de licitación para normalizarlo.
 * Ej: "LA-050GYR019-E11-2026" → "la-050gyr019-e11-2026"
 */
export function normalizeTenderNumber(number: string): string {
  return number.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Extrae el año de un número de licitación (ej: "2026" de "LA-050GYR019-E11-2026").
 */
export function extractYearFromTenderNumber(number: string): number | null {
  const match = number.match(/\b(20\d{2})\b/);
  return match ? parseInt(match[1]) : null;
}

/**
 * Detecta si el input es un número de licitación formal (patrón CompraNet).
 * Ej: LA-050GYR019-E11-2026, IA-917047998-E4-2026
 */
export function isFormalTenderNumber(query: string): boolean {
  // Formato: 2 letras - identificador alfanumérico - E<num> - año
  return /^[A-Z]{2}-[A-Z0-9]+-E\d+-\d{4}$/i.test(query.trim());
}
