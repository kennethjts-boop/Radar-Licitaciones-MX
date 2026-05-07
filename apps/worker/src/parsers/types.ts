/**
 * PARSER TYPES — Interfaces compartidas por todos los parsers documentales.
 */

export interface ParseResult {
  text: string;
  pageCount?: number;
  metadata?: Record<string, unknown>;
  parseStatus: "ok" | "empty" | "needs_ocr" | "error";
  errors: string[];
}

export interface XlsxSheet {
  name: string;
  rows: string[][];
  hasCatalogColumns: boolean;
}

export interface XlsxParseResult extends ParseResult {
  sheets: XlsxSheet[];
  isCatalogConceptos: boolean;
}

export interface ZipEntry {
  fileName: string;
  fileType: string;
  parseResult: ParseResult | null;
}

export interface ZipParseResult {
  files: ZipEntry[];
  parseStatus: "ok" | "partial" | "empty" | "error";
  errors: string[];
}
