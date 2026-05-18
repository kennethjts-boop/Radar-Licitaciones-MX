/**
 * XLSX PARSER — Extrae texto y estructura de hojas Excel usando ExcelJS.
 * Detecta catálogos de conceptos (presupuesto de obra) por columnas características.
 */
import ExcelJS from "exceljs";
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

function cellValueToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);

  const record = value as unknown as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (record.result !== undefined) {
    return cellValueToString(record.result as ExcelJS.CellValue);
  }
  if (Array.isArray(record.richText)) {
    return record.richText
      .map((part) => {
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }

  return JSON.stringify(value);
}

function toCsvLine(row: string[]): string {
  return row
    .map((cell) => {
      if (/[",\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
      return cell;
    })
    .join(",");
}

function workbookToResult(workbook: ExcelJS.Workbook): XlsxParseResult {
  if (workbook.worksheets.length === 0) {
    return { text: "", parseStatus: "empty", errors: [], sheets: [], isCatalogConceptos: false };
  }

  const sheets: XlsxSheet[] = [];
  const textParts: string[] = [];

  for (const worksheet of workbook.worksheets) {
    const rows: string[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        cells.push(cellValueToString(cell.value).trim());
      });
      if (cells.some((cell) => cell.length > 0)) rows.push(cells);
    });

    const firstRowCsv = rows[0]?.join(",") ?? "";
    const hasCatalogColumns = detectCatalogColumns(firstRowCsv);
    const csv = rows.map(toCsvLine).join("\n");

    sheets.push({ name: worksheet.name, rows, hasCatalogColumns });
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
}

export async function parseXlsx(localPath: string): Promise<XlsxParseResult> {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(localPath);
    return workbookToResult(workbook);
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

export async function parseXlsxBuffer(buffer: Buffer): Promise<XlsxParseResult> {
  try {
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
    await workbook.xlsx.load(
      arrayBuffer as Parameters<typeof workbook.xlsx.load>[0],
    );
    return workbookToResult(workbook);
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
