/**
 * TEXT — Normalización de texto para canonicalización y matching.
 * Esencial para que el matcher no falle por tildes, mayúsculas o espacios.
 */

/**
 * Normaliza texto para comparación:
 * - Minúsculas
 * - Sin tildes/diacríticos
 * - Sin puntuación extra
 * - Sin espacios múltiples
 * - Trim
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita diacríticos
    .replace(/[^\w\s]/g, " ") // reemplaza puntuación con espacio
    .replace(/\s+/g, " ") // colapsa espacios
    .trim();
}

/**
 * Limpia texto para búsquedas por keyword con RegExp.
 */
export function sanitizeForKeywordRegex(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrae tokens únicos de un texto normalizado (palabras ≥ 3 chars).
 */
export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  const tokens = normalized.split(" ").filter((t) => t.length >= 3);
  return [...new Set(tokens)];
}

function tokenVariants(token: string): Set<string> {
  const variants = new Set([token]);

  if (token.length > 3 && token.endsWith("s")) {
    variants.add(token.slice(0, -1));
  }

  if (token.length > 4 && token.endsWith("es")) {
    variants.add(token.slice(0, -2));
  }

  if (token.length > 4 && token.endsWith("ces")) {
    variants.add(`${token.slice(0, -3)}z`);
  }

  return variants;
}

function tokensEquivalent(a: string, b: string): boolean {
  if (a === b) return true;

  const aVariants = tokenVariants(a);
  const bVariants = tokenVariants(b);

  for (const variant of aVariants) {
    if (bVariants.has(variant)) return true;
  }

  return false;
}

/**
 * Construye el canonical_text de un expediente combinando múltiples campos.
 */
export function buildCanonicalText(params: {
  title: string;
  description?: string | null;
  dependencyName?: string | null;
  buyingUnit?: string | null;
  state?: string | null;
  attachmentTexts?: string[];
}): string {
  const parts = [
    params.title,
    params.description ?? "",
    params.dependencyName ?? "",
    params.buyingUnit ?? "",
    params.state ?? "",
    ...(params.attachmentTexts ?? []),
  ];
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" | ");
}

/**
 * Verifica si un término (o variante normalizada) aparece en el texto canónico.
 */
export function textContainsTerm(canonicalText: string, term: string): boolean {
  const normText = normalizeText(canonicalText);
  const normTerm = normalizeText(term);
  if (!normText || !normTerm) return false;

  const textTokens = normText.split(" ").filter(Boolean);
  const termTokens = normTerm.split(" ").filter(Boolean);
  if (termTokens.length === 0 || termTokens.length > textTokens.length) {
    return false;
  }

  for (let i = 0; i <= textTokens.length - termTokens.length; i++) {
    const windowMatches = termTokens.every((termToken, offset) =>
      tokensEquivalent(textTokens[i + offset], termToken),
    );
    if (windowMatches) return true;
  }

  return false;
}

/**
 * Retorna qué términos de una lista aparecen en el texto.
 */
export function findMatchingTerms(
  canonicalText: string,
  terms: string[],
): string[] {
  return terms.filter((term) => textContainsTerm(canonicalText, term));
}

/**
 * Retorna qué términos de exclusión aparecen en el texto.
 */
export function findExcludedTerms(
  canonicalText: string,
  exclusions: string[],
): string[] {
  return exclusions.filter((term) => textContainsTerm(canonicalText, term));
}

/**
 * Trunca texto para Telegram (máx 4096 chars por mensaje).
 */
export function truncateForTelegram(text: string, maxLength = 4000): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Escapa caracteres especiales de MarkdownV2 de Telegram.
 */
export function escapeTelegramMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, (char) => `\\${char}`);
}

/**
 * Formatea moneda MXN para display.
 */
export function formatCurrency(
  amount: number | null,
  currency: string | null,
): string {
  if (amount === null || amount === 0) return "No especificado";
  const curr = currency ?? "MXN";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: curr,
    maximumFractionDigits: 0,
  }).format(amount);
}
