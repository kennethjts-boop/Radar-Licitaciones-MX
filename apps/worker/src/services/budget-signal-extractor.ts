/**
 * BUDGET SIGNAL EXTRACTOR — Extrae señales de monto presupuestal en pesos mexicanos.
 * Función pura: sin I/O, sin efectos secundarios.
 */

export interface BudgetSignal {
  rawText: string;
  amount: number;
  confidence: "alta" | "media" | "baja";
}

export interface BudgetSignalResult {
  signals: BudgetSignal[];
  hasSignals: boolean;
  highestAmount: number | null;
}

const BUDGET_KEYWORDS_HIGH = ["presupuesto", "techo", "monto", "valor estimado", "importe total"];
const BUDGET_KEYWORDS_MED = ["importe", "costo", "precio total", "valor"];
const CONTEXT_WINDOW = 120;

function parseAmount(raw: string): number {
  const clean = raw.replace(/[$\s,]/g, "");
  return parseFloat(clean);
}

function getConfidence(contextSnippet: string): "alta" | "media" | "baja" {
  const lower = contextSnippet.toLowerCase();
  if (BUDGET_KEYWORDS_HIGH.some((kw) => lower.includes(kw))) return "alta";
  if (BUDGET_KEYWORDS_MED.some((kw) => lower.includes(kw))) return "media";
  return "baja";
}

export function extractBudgetSignals(text: string): BudgetSignalResult {
  if (!text) return { signals: [], hasSignals: false, highestAmount: null };

  const signals: BudgetSignal[] = [];

  // Patrón 1: $1,234,567.89 o $1234567
  const dollarPattern = /\$\s*([\d,]+(?:\.\d{1,2})?)/g;
  let match: RegExpExecArray | null;

  while ((match = dollarPattern.exec(text)) !== null) {
    const amount = parseAmount(match[1]);
    if (!isNaN(amount) && amount >= 1000) {
      const start = Math.max(0, match.index - CONTEXT_WINDOW);
      const end = Math.min(text.length, match.index + match[0].length + CONTEXT_WINDOW);
      const context = text.slice(start, end);
      signals.push({ rawText: match[0].trim(), amount, confidence: getConfidence(context) });
    }
  }

  // Patrón 2: N millones (de pesos)
  const millionPattern = /(\d+(?:\.\d+)?)\s*mill[oó]n(?:es)?(?:\s+de\s+pesos?)?/gi;
  while ((match = millionPattern.exec(text)) !== null) {
    const amount = parseFloat(match[1]) * 1_000_000;
    if (!isNaN(amount)) {
      const start = Math.max(0, match.index - CONTEXT_WINDOW);
      const end = Math.min(text.length, match.index + match[0].length + CONTEXT_WINDOW);
      const context = text.slice(start, end);
      signals.push({ rawText: match[0].trim(), amount, confidence: getConfidence(context) });
    }
  }

  // Patrón 3: MXN 1,234,567
  const mxnPattern = /MXN\s*([\d,]+(?:\.\d{1,2})?)/gi;
  while ((match = mxnPattern.exec(text)) !== null) {
    const amount = parseAmount(match[1]);
    if (!isNaN(amount) && amount >= 1000) {
      const start = Math.max(0, match.index - CONTEXT_WINDOW);
      const end = Math.min(text.length, match.index + match[0].length + CONTEXT_WINDOW);
      const context = text.slice(start, end);
      signals.push({ rawText: match[0].trim(), amount, confidence: getConfidence(context) });
    }
  }

  if (signals.length === 0) {
    return { signals: [], hasSignals: false, highestAmount: null };
  }

  const highestAmount = Math.max(...signals.map((s) => s.amount));
  return { signals, hasSignals: true, highestAmount };
}
