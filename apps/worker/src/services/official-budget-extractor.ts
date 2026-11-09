/**
 * OFFICIAL BUDGET EXTRACTOR — presupuesto oficial del PROCEDIMIENTO específico.
 * Función pura. A diferencia de `budget-signal-extractor` (cualquier $), sólo
 * acepta cifras rotuladas como presupuesto/monto/techo del procedimiento o
 * contratación y descarta capital contable, costo de bases, garantías,
 * anticipos, penas, experiencia acreditada y presupuestos generales de programa.
 */
import { normalizeText } from "../core/text";

export interface OfficialBudgetFinding {
  amount: number;
  /** Página (1-based) donde consta el presupuesto. */
  page: number;
  label: string;
  excerpt: string;
}

const LABEL = new RegExp(
  "(?:presupuesto|monto|importe|techo|valor)\\s+" +
    "(?:(?:maximo|total|autorizado|asignado|estimado|disponible|presupuestal|global)\\s+)*" +
    "(?:(?:maximo|total|autorizado|asignado|estimado|disponible|presupuestal|global)\\b|" +
    "(?:del|de la|para el|para la)\\s+(?:procedimiento|contratacion|contrato|licitacion|presente procedimiento))" +
    "|techo presupuestal|suficiencia presupuest\\w+",
  "g",
);
const MIN_ONLY = /\b(?:presupuesto|monto|importe)\s+minimo\b/;
const EXCLUDE = new RegExp(
  "capital (?:contable|social)|costo de (?:las )?bases|bases de (?:la )?licitacion|garantia|fianza|cheque|anticipo|" +
    "pena(?:s)? convencional|deductiva|presupuesto de egresos|presupuesto general|ingresos|ventas|facturacion|" +
    "contratos? (?:similar|acreditad)\\w*|experiencia|programa (?:presupuestario|de inversion)|inversion total del programa|" +
    "hasta por un monto de la garantia",
);
const AMOUNT = /\$\s*([\d]{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(\d+(?:\.\d+)?)\s+millon(?:es)?(?:\s+de\s+pesos)?/g;
const WINDOW = 160;

function pageFindings(text: string, page: number): OfficialBudgetFinding[] {
  const folded = normalizeTextKeepLength(text);
  const out: OfficialBudgetFinding[] = [];
  LABEL.lastIndex = 0;
  let label: RegExpExecArray | null;
  while ((label = LABEL.exec(folded)) !== null) {
    const start = label.index;
    const after = folded.slice(start, start + label[0].length + WINDOW);
    const before = folded.slice(Math.max(0, start - 60), start);
    // El rótulo y su ventana inmediata no deben hablar de otra cosa.
    if (EXCLUDE.test(after) || EXCLUDE.test(before)) continue;
    if (MIN_ONLY.test(label[0])) continue;
    AMOUNT.lastIndex = 0;
    const tail = text.slice(start + label[0].length, start + label[0].length + WINDOW);
    const found = AMOUNT.exec(tail);
    if (!found) continue;
    const amount = found[1] !== undefined
      ? Number(found[1].replace(/,/g, ""))
      : Number(found[2]) * 1_000_000;
    if (!Number.isFinite(amount) || amount < 1000) continue;
    out.push({
      amount, page, label: label[0].replace(/\s+/g, " ").trim(),
      excerpt: text.slice(start, start + label[0].length + found.index + found[0].length + 40).replace(/\s+/g, " ").trim().slice(0, 260),
    });
  }
  return out;
}

/** Pliega acentos y mayúsculas sin cambiar la longitud (para mantener los índices del texto original). */
function normalizeTextKeepLength(text: string): string {
  let result = "";
  for (const char of text) {
    const folded = normalizeText(char);
    result += folded.length === 1 ? folded : char === "\n" || char === "\t" ? " " : folded.length === 0 ? " " : folded[0];
  }
  return result;
}

/**
 * Mejor cifra del presupuesto del procedimiento. Con varias candidatas toma la
 * mayor entre las rotuladas como máximo/total/autorizado (tope del procedimiento).
 */
export function extractOfficialBudget(pages: readonly string[]): OfficialBudgetFinding | null {
  const findings = pages.flatMap((text, index) => (text ? pageFindings(text, index + 1) : []));
  if (findings.length === 0) return null;
  return findings.reduce((best, current) => (current.amount > best.amount ? current : best));
}
