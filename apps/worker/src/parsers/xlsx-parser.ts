/**
 * XLSX PARSER — Extrae texto y estructura de hojas Excel usando SheetJS.
 * Detecta catálogos de conceptos (presupuesto de obra) por columnas características.
 */
import * as XLSX from "xlsx";
import type { XlsxParseResult, XlsxSheet } from "./types";

const CATALOG_KEYWORDS = ["partida", "descripcion", "concepto", "cantidad", "precio", "importe", "unidad", "total"];
const CATALOG_MIN_MATCHES = 3;

function detectCatalogColumns(firstRow: string): boolean {
  const lower = firstRow.toLowerCase();
  let matches = 0;
  for (const kw of CATALOG_KEYWORDS) {
    if (lower.includes(kw)) matches++;
    if (matches >= CATALOG_MIN_MATCHES) return true;
  }
  return false;
}

export async function parseXlsx(localPath: string): Promise<XlsxParseResult> {
  try {
    const workbook = XLSX.readFile(localPath);
    if (workbook.SheetNames.length === 0) {
      return { text: "", parseStatus: "empty", errors: [], sheets: [], isCatalogConceptos: false };
    }

    const sheets: XlsxSheet[] = [];
    const textParts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(ws);
      const rows = csv
        .split("\n")
        .map((line) => line.split(",").map((cell) => cell.trim()))
        .filter((row) => row.some((cell) => cell.length > 0));

      const firstRowCsv = rows[0]?.join(",") ?? "";
      const hasCatalogColumns = detectCatalogColumns(firstRowCsv);

      sheets.push({ name: sheetName, rows, hasCatalogColumns });
      if (csv.trim()) textParts.push(csv.trim());
    }

    const text = textParts.join("\n\n");
    const isCatalogConceptos = sheets.some((s) => s.hasCatalogColumns);

    return {
      text,
      parseStatus: text ? "ok" : "empty",
      errors: [],
      sheets,
      isCatalogConceptos,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: "",
      parseStatus: "error",
      errors: [msg],
      sheets: [],
      isCatalogConceptos: false,
    };
  }
}
