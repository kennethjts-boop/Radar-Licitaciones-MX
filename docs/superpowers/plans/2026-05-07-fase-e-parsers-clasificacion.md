# Fase E — Parsers documentales y clasificación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un pipeline de análisis de contenido para los documentos descargados en Fase D: parsear PDF/DOCX/XLSX/ZIP, clasificar cada documento y extraer señales de presupuesto para mostrar el techo estimado en la alerta Telegram.

**Architecture:** Capa de parsers en `src/parsers/` (tipos compartidos + cuatro parsers especializados), dos servicios puros sin I/O en `src/services/` (clasificador y extractor de señales), y una integración no-bloqueante en `enrich-procurement.job.ts` que corre los parsers sobre los archivos ya descargados antes de armar el mensaje Telegram.

**Tech Stack:** Node.js 20 / TypeScript strict / pdf-parse (already installed) / mammoth (install) / xlsx/SheetJS (already installed) / adm-zip (install) / Jest + ts-jest

---

## File Map

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `src/parsers/types.ts` | Crear | Interfaces compartidas: `ParseResult`, `XlsxParseResult`, `ZipParseResult`, `ZipEntry` |
| `src/parsers/pdf-parser.ts` | Crear | Wraps `extractTextFromPdf`; devuelve `ParseResult` con `parseStatus` |
| `src/parsers/docx-parser.ts` | Crear | mammoth `extractRawText`; devuelve `ParseResult` |
| `src/parsers/xlsx-parser.ts` | Crear | SheetJS; devuelve `XlsxParseResult` con sheets y detección de catálogo |
| `src/parsers/zip-parser.ts` | Crear | adm-zip; parsea entradas con los 3 parsers anteriores vía buffer API |
| `src/services/document-classifier.ts` | Crear | Función pura; 14 `DocumentType`; keyword matching + confidence |
| `src/services/budget-signal-extractor.ts` | Crear | Función pura; regex de montos MXN; devuelve `BudgetSignalResult` |
| `src/parsers/__tests__/pdf-parser.test.ts` | Crear | 5 tests |
| `src/parsers/__tests__/docx-parser.test.ts` | Crear | 4 tests |
| `src/parsers/__tests__/xlsx-parser.test.ts` | Crear | 5 tests |
| `src/parsers/__tests__/zip-parser.test.ts` | Crear | 5 tests |
| `src/services/__tests__/document-classifier.test.ts` | Crear | 14+ tests |
| `src/services/__tests__/budget-signal-extractor.test.ts` | Crear | 7 tests |
| `src/jobs/enrich-procurement.job.ts` | Modificar | Agregar paso 5: parse+classify+budget tras descargas |
| `src/alerts/telegram.alerts.ts` | Modificar | `EnrichedAlertData.budgetSignal` opcional + sección en `formatEnrichedAlert` |
| `src/alerts/__tests__/telegram.enriched.test.ts` | Modificar | Agregar 3 tests de presupuesto |
| `src/jobs/__tests__/enrich-procurement.test.ts` | Modificar | Agregar 2 tests de integración con parsers |

---

## Task E0: Shared types + install dependencies

**Files:**
- Create: `src/parsers/types.ts`

- [ ] **Step 1: Instalar mammoth y adm-zip**

```bash
cd /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX/apps/worker
npm install mammoth adm-zip
```

Expected: both packages in node_modules, package.json updated.

- [ ] **Step 2: Crear `src/parsers/types.ts`**

```typescript
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
```

- [ ] **Step 3: Verificar typecheck**

```bash
npm run typecheck
```

Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX add apps/worker/src/parsers/types.ts apps/worker/package.json apps/worker/package-lock.json
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX commit -m "feat: instalar mammoth/adm-zip y agregar src/parsers/types.ts"
```

---

## Task E1: PDF Parser

**Files:**
- Create: `src/parsers/__tests__/pdf-parser.test.ts`
- Create: `src/parsers/pdf-parser.ts`

The PDF parser wraps `extractTextFromPdf` from `src/utils/pdf.util.ts`. A result with fewer than 50 characters likely means the PDF is scanned (needs OCR), not truly empty text.

- [ ] **Step 1: Escribir el test**

```typescript
// src/parsers/__tests__/pdf-parser.test.ts
import { parsePdf } from "../pdf-parser";
import * as pdfUtil from "../../utils/pdf.util";

jest.mock("../../utils/pdf.util");
const mockExtract = pdfUtil.extractTextFromPdf as jest.MockedFunction<typeof pdfUtil.extractTextFromPdf>;

describe("parsePdf", () => {
  beforeEach(() => jest.clearAllMocks());

  it("parseStatus=ok cuando texto >= 50 chars", async () => {
    mockExtract.mockResolvedValue("A".repeat(100));
    const result = await parsePdf("/tmp/test.pdf");
    expect(result.parseStatus).toBe("ok");
    expect(result.text).toBe("A".repeat(100));
    expect(result.errors).toHaveLength(0);
  });

  it("parseStatus=empty cuando texto vacío", async () => {
    mockExtract.mockResolvedValue("");
    const result = await parsePdf("/tmp/test.pdf");
    expect(result.parseStatus).toBe("empty");
    expect(result.text).toBe("");
  });

  it("parseStatus=needs_ocr cuando texto < 50 chars", async () => {
    mockExtract.mockResolvedValue("poco texto");
    const result = await parsePdf("/tmp/test.pdf");
    expect(result.parseStatus).toBe("needs_ocr");
  });

  it("parseStatus=error cuando extractTextFromPdf lanza", async () => {
    mockExtract.mockRejectedValue(new Error("PDF corrupto"));
    const result = await parsePdf("/tmp/test.pdf");
    expect(result.parseStatus).toBe("error");
    expect(result.errors[0]).toContain("PDF corrupto");
  });

  it("no hace throw en ningún caso", async () => {
    mockExtract.mockRejectedValue(new Error("fatal"));
    await expect(parsePdf("/tmp/test.pdf")).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX/apps/worker
npx jest src/parsers/__tests__/pdf-parser.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '../pdf-parser'"

- [ ] **Step 3: Implementar `src/parsers/pdf-parser.ts`**

```typescript
/**
 * PDF PARSER — Extrae texto de un PDF local usando pdf.util.extractTextFromPdf.
 * Devuelve ParseResult con needs_ocr si el texto es muy corto (probable PDF escaneado).
 */
import { extractTextFromPdf } from "../utils/pdf.util";
import type { ParseResult } from "./types";

const MIN_TEXT_LENGTH_FOR_OK = 50;

export async function parsePdf(localPath: string): Promise<ParseResult> {
  try {
    const text = await extractTextFromPdf(localPath);
    if (!text) {
      return { text: "", parseStatus: "empty", errors: [] };
    }
    if (text.length < MIN_TEXT_LENGTH_FOR_OK) {
      return { text, parseStatus: "needs_ocr", errors: [] };
    }
    return { text, parseStatus: "ok", errors: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: "", parseStatus: "error", errors: [msg] };
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
npx jest src/parsers/__tests__/pdf-parser.test.ts --no-coverage
```

Expected: PASS — 5/5

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX add apps/worker/src/parsers/
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX commit -m "feat: E1 — agregar parsePdf con test"
```

---

## Task E2: DOCX Parser

**Files:**
- Create: `src/parsers/__tests__/docx-parser.test.ts`
- Create: `src/parsers/docx-parser.ts`

Usa la API de mammoth que acepta `{ path: string }`. mammoth@1.x tiene tipos bundled, no se necesita `@types/mammoth`.

- [ ] **Step 1: Escribir el test**

```typescript
// src/parsers/__tests__/docx-parser.test.ts
import { parseDocx } from "../docx-parser";
import mammoth from "mammoth";

jest.mock("mammoth");
const mockMammoth = mammoth as jest.Mocked<typeof mammoth>;

describe("parseDocx", () => {
  beforeEach(() => jest.clearAllMocks());

  it("parseStatus=ok con texto extraído", async () => {
    (mockMammoth.extractRawText as jest.Mock).mockResolvedValue({ value: "Bases de licitación para mantenimiento vial.", messages: [] });
    const result = await parseDocx("/tmp/test.docx");
    expect(result.parseStatus).toBe("ok");
    expect(result.text).toBe("Bases de licitación para mantenimiento vial.");
    expect(result.errors).toHaveLength(0);
  });

  it("parseStatus=empty cuando mammoth devuelve texto vacío", async () => {
    (mockMammoth.extractRawText as jest.Mock).mockResolvedValue({ value: "   ", messages: [] });
    const result = await parseDocx("/tmp/test.docx");
    expect(result.parseStatus).toBe("empty");
    expect(result.text).toBe("");
  });

  it("parseStatus=error cuando mammoth lanza", async () => {
    (mockMammoth.extractRawText as jest.Mock).mockRejectedValue(new Error("DOCX inválido"));
    const result = await parseDocx("/tmp/test.docx");
    expect(result.parseStatus).toBe("error");
    expect(result.errors[0]).toContain("DOCX inválido");
  });

  it("no hace throw en ningún caso", async () => {
    (mockMammoth.extractRawText as jest.Mock).mockRejectedValue(new Error("fatal"));
    await expect(parseDocx("/tmp/test.docx")).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npx jest src/parsers/__tests__/docx-parser.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '../docx-parser'"

- [ ] **Step 3: Implementar `src/parsers/docx-parser.ts`**

```typescript
/**
 * DOCX PARSER — Extrae texto plano de un DOCX usando mammoth.
 */
import mammoth from "mammoth";
import type { ParseResult } from "./types";

export async function parseDocx(localPath: string): Promise<ParseResult> {
  try {
    const result = await mammoth.extractRawText({ path: localPath });
    const text = result.value.trim();
    if (!text) {
      return { text: "", parseStatus: "empty", errors: [] };
    }
    return { text, parseStatus: "ok", errors: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: "", parseStatus: "error", errors: [msg] };
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
npx jest src/parsers/__tests__/docx-parser.test.ts --no-coverage
```

Expected: PASS — 4/4

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX add apps/worker/src/parsers/
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX commit -m "feat: E2 — agregar parseDocx con test"
```

---

## Task E3: XLSX Parser

**Files:**
- Create: `src/parsers/__tests__/xlsx-parser.test.ts`
- Create: `src/parsers/xlsx-parser.ts`

SheetJS (xlsx) ya está instalado. Devuelve `XlsxParseResult` con cada hoja como matriz de filas. Detecta catálogo de conceptos buscando ≥3 palabras clave de columna en la primera fila.

Palabras clave de catálogo: `descripcion`, `partida`, `concepto`, `cantidad`, `precio`, `importe`, `unidad`, `total`.

- [ ] **Step 1: Escribir el test**

```typescript
// src/parsers/__tests__/xlsx-parser.test.ts
import { parseXlsx } from "../xlsx-parser";
import * as XLSX from "xlsx";

jest.mock("xlsx");
const mockXLSX = XLSX as jest.Mocked<typeof XLSX>;

function makeWorkbook(sheets: Record<string, string[][]>): XLSX.WorkBook {
  const wb: XLSX.WorkBook = { SheetNames: Object.keys(sheets), Sheets: {} };
  for (const [name, rows] of Object.entries(sheets)) {
    wb.Sheets[name] = {} as XLSX.WorkSheet;
    // sheet_to_csv will be mocked per test
  }
  return wb;
}

describe("parseXlsx", () => {
  beforeEach(() => jest.clearAllMocks());

  it("parseStatus=ok con una hoja normal", async () => {
    const wb = makeWorkbook({ "Hoja1": [] });
    (mockXLSX.readFile as jest.Mock).mockReturnValue(wb);
    (mockXLSX.utils.sheet_to_csv as jest.Mock).mockReturnValue("Col1,Col2\nVal1,Val2");
    const result = await parseXlsx("/tmp/test.xlsx");
    expect(result.parseStatus).toBe("ok");
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].name).toBe("Hoja1");
    expect(result.isCatalogConceptos).toBe(false);
  });

  it("detecta catálogo de conceptos por encabezados", async () => {
    const wb = makeWorkbook({ "Catálogo": [] });
    (mockXLSX.readFile as jest.Mock).mockReturnValue(wb);
    // First row has catalog keywords
    (mockXLSX.utils.sheet_to_csv as jest.Mock).mockReturnValue("Partida,Descripcion,Cantidad,Precio,Importe\n1,Tubería,100,500,50000");
    const result = await parseXlsx("/tmp/catalogo.xlsx");
    expect(result.isCatalogConceptos).toBe(true);
    expect(result.sheets[0].hasCatalogColumns).toBe(true);
  });

  it("parseStatus=empty cuando workbook sin hojas", async () => {
    (mockXLSX.readFile as jest.Mock).mockReturnValue({ SheetNames: [], Sheets: {} } as XLSX.WorkBook);
    const result = await parseXlsx("/tmp/empty.xlsx");
    expect(result.parseStatus).toBe("empty");
    expect(result.sheets).toHaveLength(0);
  });

  it("parseStatus=error cuando XLSX.readFile lanza", async () => {
    (mockXLSX.readFile as jest.Mock).mockImplementation(() => { throw new Error("archivo corrupto"); });
    const result = await parseXlsx("/tmp/bad.xlsx");
    expect(result.parseStatus).toBe("error");
    expect(result.errors[0]).toContain("archivo corrupto");
  });

  it("no hace throw en ningún caso", async () => {
    (mockXLSX.readFile as jest.Mock).mockImplementation(() => { throw new Error("fatal"); });
    await expect(parseXlsx("/tmp/test.xlsx")).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npx jest src/parsers/__tests__/xlsx-parser.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '../xlsx-parser'"

- [ ] **Step 3: Implementar `src/parsers/xlsx-parser.ts`**

```typescript
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
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
npx jest src/parsers/__tests__/xlsx-parser.test.ts --no-coverage
```

Expected: PASS — 5/5

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX add apps/worker/src/parsers/
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX commit -m "feat: E3 — agregar parseXlsx con detección de catálogo"
```

---

## Task E4: ZIP Parser

**Files:**
- Create: `src/parsers/__tests__/zip-parser.test.ts`
- Create: `src/parsers/zip-parser.ts`

Usa adm-zip. Parsea hasta 50 archivos y 100 MB descomprimidos. Llama directamente a las APIs de buffer de pdf-parse, mammoth y xlsx (no llama a parsePdf/parseDocx/parseXlsx que requieren ruta). No parsea ZIPs anidados. Continúa si falla un archivo individual.

- [ ] **Step 1: Escribir el test**

```typescript
// src/parsers/__tests__/zip-parser.test.ts
import { parseZip } from "../zip-parser";
import AdmZip from "adm-zip";

jest.mock("adm-zip");
const MockAdmZip = AdmZip as jest.MockedClass<typeof AdmZip>;

function makeEntry(name: string, size: number, data: Buffer, isDirectory = false) {
  return {
    entryName: name,
    isDirectory,
    header: { size },
    getData: () => data,
  };
}

describe("parseZip", () => {
  beforeEach(() => jest.clearAllMocks());

  it("parseStatus=empty cuando zip sin archivos parseables", async () => {
    MockAdmZip.prototype.getEntries = jest.fn().mockReturnValue([
      makeEntry("readme.txt", 10, Buffer.from("hello"), false),
    ]);
    const result = await parseZip("/tmp/test.zip");
    expect(result.parseStatus).toBe("empty");
    expect(result.files).toHaveLength(0);
  });

  it("respeta límite de 50 archivos", async () => {
    const entries = Array.from({ length: 55 }, (_, i) =>
      makeEntry(`file${i}.txt`, 10, Buffer.from("x"), false)
    );
    MockAdmZip.prototype.getEntries = jest.fn().mockReturnValue(entries);
    const result = await parseZip("/tmp/big.zip");
    expect(result.errors.some((e) => e.includes("50"))).toBe(true);
  });

  it("respeta límite de 100 MB total", async () => {
    const entries = [
      makeEntry("a.pdf", 60 * 1024 * 1024, Buffer.from("a"), false),
      makeEntry("b.pdf", 60 * 1024 * 1024, Buffer.from("b"), false),
    ];
    MockAdmZip.prototype.getEntries = jest.fn().mockReturnValue(entries);
    const result = await parseZip("/tmp/huge.zip");
    expect(result.errors.some((e) => e.includes("100"))).toBe(true);
  });

  it("parseStatus=error cuando AdmZip lanza al construirse", async () => {
    MockAdmZip.mockImplementationOnce(() => { throw new Error("zip inválido"); });
    const result = await parseZip("/tmp/bad.zip");
    expect(result.parseStatus).toBe("error");
    expect(result.errors[0]).toContain("zip inválido");
  });

  it("no hace throw en ningún caso", async () => {
    MockAdmZip.mockImplementationOnce(() => { throw new Error("fatal"); });
    await expect(parseZip("/tmp/test.zip")).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npx jest src/parsers/__tests__/zip-parser.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '../zip-parser'"

- [ ] **Step 3: Implementar `src/parsers/zip-parser.ts`**

```typescript
/**
 * ZIP PARSER — Descomprime y parsea archivos PDF/DOCX/XLSX dentro de un ZIP.
 * Límites: máximo 50 archivos, 100 MB total descomprimido. No parsea ZIPs anidados.
 * Continúa si un archivo individual falla.
 */
import AdmZip from "adm-zip";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { createModuleLogger } from "../core/logger";
import type { ParseResult, ZipEntry, ZipParseResult } from "./types";

const log = createModuleLogger("zip-parser");

const MAX_ZIP_FILES = 50;
const MAX_ZIP_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MB

const PARSEABLE_EXTENSIONS = new Set(["pdf", "docx", "doc", "xlsx", "xls"]);

function getExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

async function parseEntryBuffer(ext: string, buffer: Buffer): Promise<ParseResult> {
  if (ext === "pdf") {
    const parsed = await pdf(buffer);
    const text = (parsed.text ?? "").trim();
    return { text, parseStatus: text ? "ok" : "empty", errors: [] };
  }
  if (ext === "docx" || ext === "doc") {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    return { text, parseStatus: text ? "ok" : "empty", errors: [] };
  }
  if (ext === "xlsx" || ext === "xls") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const textParts: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
      if (csv.trim()) textParts.push(csv.trim());
    }
    const text = textParts.join("\n\n");
    return { text, parseStatus: text ? "ok" : "empty", errors: [] };
  }
  return { text: "", parseStatus: "error", errors: [`extensión no soportada: ${ext}`] };
}

export async function parseZip(localPath: string): Promise<ZipParseResult> {
  const errors: string[] = [];
  const files: ZipEntry[] = [];

  try {
    const zip = new AdmZip(localPath);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);

    // Límite de archivos
    if (entries.length > MAX_ZIP_FILES) {
      errors.push(`ZIP excede el límite de ${MAX_ZIP_FILES} archivos (${entries.length} encontrados)`);
    }

    let totalBytes = 0;
    let stopped = false;

    for (const entry of entries) {
      if (stopped) break;

      const ext = getExtension(entry.entryName);

      // Saltar no-parseables (incluyendo ZIPs anidados)
      if (!PARSEABLE_EXTENSIONS.has(ext)) continue;

      // Límite de tamaño acumulado
      totalBytes += entry.header.size;
      if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
        errors.push(`ZIP excede el límite de 100 MB descomprimido`);
        stopped = true;
        break;
      }

      // Parsear entry
      try {
        const buffer = entry.getData();
        const parseResult = await parseEntryBuffer(ext, buffer);
        files.push({ fileName: entry.entryName, fileType: ext, parseResult });
      } catch (entryErr) {
        const msg = entryErr instanceof Error ? entryErr.message : String(entryErr);
        log.warn({ entryName: entry.entryName, err: msg }, "⚠️ Error parseando entrada de ZIP");
        errors.push(`${entry.entryName}: ${msg}`);
        files.push({ fileName: entry.entryName, fileType: ext, parseResult: null });
      }
    }

    // Determinar status
    let parseStatus: ZipParseResult["parseStatus"];
    const parsed = files.filter((f) => f.parseResult !== null);
    if (files.length === 0) {
      parseStatus = "empty";
    } else if (parsed.length === files.length && errors.length === 0) {
      parseStatus = "ok";
    } else if (parsed.length > 0) {
      parseStatus = "partial";
    } else {
      parseStatus = "error";
    }

    return { files, parseStatus, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { files: [], parseStatus: "error", errors: [msg] };
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
npx jest src/parsers/__tests__/zip-parser.test.ts --no-coverage
```

Expected: PASS — 5/5

- [ ] **Step 5: Correr todos los tests**

```bash
npm test -- --no-coverage
```

Expected: ≥180 tests passing, 0 failing.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX add apps/worker/src/parsers/
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX commit -m "feat: E4 — agregar parseZip con límites 50 archivos / 100 MB"
```

---

## Task E5: Document Classifier

**Files:**
- Create: `src/services/__tests__/document-classifier.test.ts`
- Create: `src/services/document-classifier.ts`

Función pura — no I/O, no mocks necesarios. Clasifica en 14 tipos usando keyword matching sobre el texto extraído (normalizado). La confianza sube si también coincide el `documentHint` del colector (ya es una clasificación coarse previa).

Los 14 tipos y sus keywords:

| DocumentType | Keywords principales |
|---|---|
| `convocatoria` | convocatoria, licitacion publica, invitacion a cuando menos |
| `bases` | bases de licitacion, terminos de referencia, especificaciones |
| `anexo_tecnico` | anexo tecnico, anexo t, terminos de referencia tecnico |
| `anexo_economico` | anexo economico, precios unitarios, presupuesto base |
| `contrato` | contrato de, convenio de, pedido numero, orden de compra |
| `acta_apertura` | acta de apertura, apertura de propuestas |
| `fallo` | fallo de adjudicacion, resultado de la licitacion, empresa adjudicada |
| `catalogo_conceptos` | catalogo de conceptos, presupuesto de obra, volumen de obra, catalogo de |
| `propuesta_tecnica` | propuesta tecnica, oferta tecnica, solucion tecnica |
| `propuesta_economica` | propuesta economica, oferta economica, precio total ofertado |
| `junta_aclaraciones` | junta de aclaraciones, preguntas y respuestas, aclaraciones al |
| `invitacion` | carta de invitacion, invitacion a participar |
| `dictamen` | dictamen de evaluacion, evaluacion tecnica, analisis de propuestas |
| `otro` | (fallback) |

- [ ] **Step 1: Escribir el test**

```typescript
// src/services/__tests__/document-classifier.test.ts
import { classifyDocument } from "../document-classifier";

describe("classifyDocument", () => {
  it("detecta convocatoria", () => {
    const r = classifyDocument({ text: "CONVOCATORIA a licitación pública nacional número LPN-001" });
    expect(r.documentType).toBe("convocatoria");
    expect(r.confidence).not.toBe("baja");
  });

  it("detecta bases", () => {
    const r = classifyDocument({ text: "BASES DE LICITACIÓN para contratación de servicios de mantenimiento" });
    expect(r.documentType).toBe("bases");
  });

  it("detecta anexo técnico", () => {
    const r = classifyDocument({ text: "ANEXO TÉCNICO — Especificaciones del servicio a contratar" });
    expect(r.documentType).toBe("anexo_tecnico");
  });

  it("detecta anexo económico", () => {
    const r = classifyDocument({ text: "ANEXO ECONÓMICO precios unitarios de los trabajos" });
    expect(r.documentType).toBe("anexo_economico");
  });

  it("detecta contrato", () => {
    const r = classifyDocument({ text: "CONTRATO DE PRESTACIÓN DE SERVICIOS que celebran..." });
    expect(r.documentType).toBe("contrato");
  });

  it("detecta acta de apertura", () => {
    const r = classifyDocument({ text: "ACTA DE APERTURA de proposiciones técnicas y económicas" });
    expect(r.documentType).toBe("acta_apertura");
  });

  it("detecta fallo", () => {
    const r = classifyDocument({ text: "FALLO DE ADJUDICACIÓN de la licitación pública LPN-001" });
    expect(r.documentType).toBe("fallo");
  });

  it("detecta catálogo de conceptos", () => {
    const r = classifyDocument({ text: "CATÁLOGO DE CONCEPTOS presupuesto de obra mantenimiento" });
    expect(r.documentType).toBe("catalogo_conceptos");
  });

  it("detecta propuesta técnica", () => {
    const r = classifyDocument({ text: "PROPUESTA TÉCNICA presentada para la licitación" });
    expect(r.documentType).toBe("propuesta_tecnica");
  });

  it("detecta propuesta económica", () => {
    const r = classifyDocument({ text: "PROPUESTA ECONÓMICA precio total ofertado $1,200,000.00" });
    expect(r.documentType).toBe("propuesta_economica");
  });

  it("detecta junta de aclaraciones", () => {
    const r = classifyDocument({ text: "JUNTA DE ACLARACIONES a las bases de licitación" });
    expect(r.documentType).toBe("junta_aclaraciones");
  });

  it("detecta invitación", () => {
    const r = classifyDocument({ text: "CARTA DE INVITACIÓN a participar en el proceso de adjudicación" });
    expect(r.documentType).toBe("invitacion");
  });

  it("detecta dictamen", () => {
    const r = classifyDocument({ text: "DICTAMEN DE EVALUACIÓN TÉCNICA de las propuestas recibidas" });
    expect(r.documentType).toBe("dictamen");
  });

  it("devuelve otro cuando no coincide nada", () => {
    const r = classifyDocument({ text: "Lorem ipsum sin palabras clave especiales" });
    expect(r.documentType).toBe("otro");
    expect(r.confidence).toBe("baja");
  });

  it("alta confianza cuando texto tiene múltiples keywords del mismo tipo", () => {
    const r = classifyDocument({ text: "FALLO DE ADJUDICACIÓN resultado de la licitacion empresa adjudicada beneficiaria" });
    expect(r.documentType).toBe("fallo");
    expect(r.confidence).toBe("alta");
  });

  it("documentHint coincidente sube confianza a alta", () => {
    const r = classifyDocument({ text: "contrato de servicios", documentHint: "contrato" });
    expect(r.documentType).toBe("contrato");
    expect(r.confidence).toBe("alta");
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npx jest src/services/__tests__/document-classifier.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '../document-classifier'"

- [ ] **Step 3: Implementar `src/services/document-classifier.ts`**

```typescript
/**
 * DOCUMENT CLASSIFIER — Clasifica un documento en 14 tipos por keyword matching.
 * Función pura: sin I/O, sin efectos secundarios.
 */
import { createModuleLogger } from "../core/logger";

const log = createModuleLogger("document-classifier");

export type DocumentType =
  | "convocatoria"
  | "bases"
  | "anexo_tecnico"
  | "anexo_economico"
  | "contrato"
  | "acta_apertura"
  | "fallo"
  | "catalogo_conceptos"
  | "propuesta_tecnica"
  | "propuesta_economica"
  | "junta_aclaraciones"
  | "invitacion"
  | "dictamen"
  | "otro";

export type ConfidenceLevel = "alta" | "media" | "baja";

export interface ClassifyInput {
  text: string;
  fileName?: string;
  documentHint?: string;
}

export interface ClassifyResult {
  documentType: DocumentType;
  confidence: ConfidenceLevel;
  matchedKeywords: string[];
}

const KEYWORD_MAP: Record<Exclude<DocumentType, "otro">, string[]> = {
  convocatoria: ["convocatoria", "licitacion publica", "invitacion a cuando menos"],
  bases: ["bases de licitacion", "terminos de referencia", "especificaciones generales"],
  anexo_tecnico: ["anexo tecnico", "terminos de referencia tecnico", "especificaciones tecnicas"],
  anexo_economico: ["anexo economico", "precios unitarios", "presupuesto base"],
  contrato: ["contrato de", "convenio de", "pedido numero", "orden de compra"],
  acta_apertura: ["acta de apertura", "apertura de propuestas", "apertura tecnica"],
  fallo: ["fallo de adjudicacion", "resultado de la licitacion", "empresa adjudicada"],
  catalogo_conceptos: ["catalogo de conceptos", "presupuesto de obra", "volumen de obra", "catalogo de"],
  propuesta_tecnica: ["propuesta tecnica", "oferta tecnica", "solucion tecnica"],
  propuesta_economica: ["propuesta economica", "oferta economica", "precio total ofertado"],
  junta_aclaraciones: ["junta de aclaraciones", "preguntas y respuestas", "aclaraciones al"],
  invitacion: ["carta de invitacion", "invitacion a participar"],
  dictamen: ["dictamen de evaluacion", "evaluacion tecnica", "analisis de propuestas"],
};

// Mapping de DocumentHint → DocumentType para boost de confianza
const HINT_TYPE_MAP: Record<string, DocumentType> = {
  convocatoria: "convocatoria",
  anexo_tecnico: "anexo_tecnico",
  anexo_economico: "anexo_economico",
  fallo: "fallo",
  contrato: "contrato",
};

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function classifyDocument(input: ClassifyInput): ClassifyResult {
  const normalized = normalizeText(`${input.text} ${input.fileName ?? ""}`);

  let bestType: DocumentType = "otro";
  let bestCount = 0;
  let bestKeywords: string[] = [];

  for (const [docType, keywords] of Object.entries(KEYWORD_MAP) as [Exclude<DocumentType, "otro">, string[]][]) {
    const matched = keywords.filter((kw) => normalizeText(kw).split(" ").every((word) => normalized.includes(word)));
    if (matched.length > bestCount) {
      bestCount = matched.length;
      bestType = docType;
      bestKeywords = matched;
    }
  }

  // Determinar confianza
  let confidence: ConfidenceLevel;
  const hintMatchesType = input.documentHint && HINT_TYPE_MAP[input.documentHint] === bestType;

  if (bestCount >= 2 || (bestCount >= 1 && hintMatchesType)) {
    confidence = "alta";
  } else if (bestCount === 1) {
    confidence = "media";
  } else {
    confidence = "baja";
  }

  log.info({ documentType: bestType, confidence, matchedKeywords: bestKeywords }, "Documento clasificado");

  return { documentType: bestType, confidence, matchedKeywords: bestKeywords };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
npx jest src/services/__tests__/document-classifier.test.ts --no-coverage
```

Expected: PASS — 16/16

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX add apps/worker/src/services/document-classifier.ts apps/worker/src/services/__tests__/document-classifier.test.ts
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX commit -m "feat: E5 — agregar classifyDocument (14 tipos, keyword matching)"
```

---

## Task E6: Budget Signal Extractor

**Files:**
- Create: `src/services/__tests__/budget-signal-extractor.test.ts`
- Create: `src/services/budget-signal-extractor.ts`

Función pura. Extrae montos en pesos mexicanos con 4 patrones regex. Calcula confianza según proximidad a palabras clave de presupuesto ("presupuesto", "techo", "monto", "importe", "valor estimado").

- [ ] **Step 1: Escribir el test**

```typescript
// src/services/__tests__/budget-signal-extractor.test.ts
import { extractBudgetSignals } from "../budget-signal-extractor";

describe("extractBudgetSignals", () => {
  it("detecta monto con símbolo $", () => {
    const r = extractBudgetSignals("El presupuesto es de $1,234,567.89 para la obra.");
    expect(r.hasSignals).toBe(true);
    expect(r.highestAmount).toBeCloseTo(1234567.89, 1);
    expect(r.signals[0].confidence).toBe("alta");
  });

  it("detecta millones en texto", () => {
    const r = extractBudgetSignals("monto estimado de 2.5 millones de pesos");
    expect(r.hasSignals).toBe(true);
    expect(r.highestAmount).toBeCloseTo(2500000, 0);
  });

  it("detecta MXN seguido de monto", () => {
    const r = extractBudgetSignals("valor MXN 850,000.00");
    expect(r.hasSignals).toBe(true);
    expect(r.highestAmount).toBeCloseTo(850000, 0);
  });

  it("highestAmount es el mayor de múltiples señales", () => {
    const r = extractBudgetSignals("techo $500,000.00 y monto máximo $1,200,000.00");
    expect(r.highestAmount).toBeCloseTo(1200000, 0);
  });

  it("confianza baja para monto sin contexto presupuestal", () => {
    const r = extractBudgetSignals("factura por $45,000.00 pagada el lunes");
    expect(r.hasSignals).toBe(true);
    // No hay keyword de presupuesto cerca
    expect(r.signals[0].confidence).toBe("baja");
  });

  it("sin señales en texto sin montos", () => {
    const r = extractBudgetSignals("Licitación de servicios de limpieza sin monto definido.");
    expect(r.hasSignals).toBe(false);
    expect(r.highestAmount).toBeNull();
    expect(r.signals).toHaveLength(0);
  });

  it("no hace throw con texto vacío", () => {
    expect(() => extractBudgetSignals("")).not.toThrow();
    const r = extractBudgetSignals("");
    expect(r.hasSignals).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npx jest src/services/__tests__/budget-signal-extractor.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '../budget-signal-extractor'"

- [ ] **Step 3: Implementar `src/services/budget-signal-extractor.ts`**

```typescript
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

// Palabras clave que indican contexto presupuestal (boost a alta/media confianza)
const BUDGET_KEYWORDS_HIGH = ["presupuesto", "techo", "monto", "valor estimado", "importe total"];
const BUDGET_KEYWORDS_MED = ["importe", "costo", "precio total", "valor"];

// Ventana de caracteres alrededor del monto para buscar keywords
const CONTEXT_WINDOW = 120;

function parseAmount(raw: string): number {
  // Quitar símbolos y espacios, mantener dígitos, comas y punto
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

  // Patrón 3: MXN 1,234,567 o MXN1234567
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
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
npx jest src/services/__tests__/budget-signal-extractor.test.ts --no-coverage
```

Expected: PASS — 7/7

- [ ] **Step 5: Correr todos los tests**

```bash
npm test -- --no-coverage
```

Expected: ≥190 tests, 0 failing.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX add apps/worker/src/services/budget-signal-extractor.ts apps/worker/src/services/__tests__/budget-signal-extractor.test.ts
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX commit -m "feat: E6 — agregar extractBudgetSignals (regex MXN, millones, $)"
```

---

## Task E-Integration: Wire parsers into enrichment pipeline

**Files:**
- Modify: `src/jobs/enrich-procurement.job.ts`
- Modify: `src/alerts/telegram.alerts.ts`
- Modify: `src/alerts/__tests__/telegram.enriched.test.ts`
- Modify: `src/jobs/__tests__/enrich-procurement.test.ts`

Después de que D3 descarga los documentos, parsear cada archivo descargado con éxito, extraer señales de presupuesto del texto combinado, y pasar `budgetSignal` a `formatEnrichedAlert`.

### Cambios en `telegram.alerts.ts`

Agregar campo opcional `budgetSignal` a `EnrichedAlertData` y una sección en `formatEnrichedAlert` justo antes del footer.

- [ ] **Step 1: Escribir tests nuevos para telegram.enriched.test.ts**

Agregar al final del `describe("formatEnrichedAlert")`:

```typescript
it("muestra techo presupuestal cuando hasSignals=true", () => {
  const msg = formatEnrichedAlert({
    procedureNumber: "LPN-001",
    expedienteId: "EXP-001",
    title: "Mantenimiento vial",
    dependency: "Secretaría de Obras",
    scope: "MORELOS_ONLY",
    documentsFound: [],
    documentsDownloaded: [],
    errors: [],
    budgetSignal: { hasSignals: true, highestAmount: 1_500_000 },
  });
  expect(msg).toContain("💰");
  expect(msg).toContain("1,500,000");
});

it("muestra 'No localizado' cuando hasSignals=false", () => {
  const msg = formatEnrichedAlert({
    procedureNumber: "LPN-001",
    expedienteId: null,
    title: null,
    dependency: null,
    scope: "MORELOS_ONLY",
    documentsFound: [],
    documentsDownloaded: [],
    errors: [],
    budgetSignal: { hasSignals: false, highestAmount: null },
  });
  expect(msg).toContain("📊");
  expect(msg).toContain("No localizado");
});

it("no muestra sección de techo si budgetSignal es undefined", () => {
  const msg = formatEnrichedAlert({
    procedureNumber: "LPN-001",
    expedienteId: null,
    title: null,
    dependency: null,
    scope: "MORELOS_ONLY",
    documentsFound: [],
    documentsDownloaded: [],
    errors: [],
  });
  expect(msg).not.toContain("Techo presupuestal");
});
```

- [ ] **Step 2: Correr tests nuevos para verificar que fallan**

```bash
npx jest src/alerts/__tests__/telegram.enriched.test.ts --no-coverage
```

Expected: 3 tests failing — `budgetSignal` no existe aún en la interfaz.

- [ ] **Step 3: Modificar `EnrichedAlertData` en `telegram.alerts.ts`**

Localizar la interfaz `EnrichedAlertData` (línea ~487) y agregar el campo al final:

```typescript
export interface EnrichedAlertData {
  procedureNumber: string;
  expedienteId: string | null;
  title: string | null;
  dependency: string | null;
  scope: string;
  documentsFound: DocumentLink[];
  documentsDownloaded: DownloadResult[];
  errors: string[];
  budgetSignal?: { hasSignals: boolean; highestAmount: number | null };
}
```

- [ ] **Step 4: Agregar sección de presupuesto en `formatEnrichedAlert`**

En `formatEnrichedAlert`, localizar el bloque de errores opcionales antes del footer (alrededor de línea 570):

```typescript
  if (data.errors.length > 0) {
    lines.push("");
    lines.push("⚠️ <b>Errores controlados:</b>");
    data.errors.slice(0, 3).forEach((e) => lines.push(`  • ${escapeHtml(e)}`));
  }
```

Justo **antes** de ese bloque (no después), agregar:

```typescript
  if (data.budgetSignal !== undefined) {
    lines.push("");
    if (data.budgetSignal.hasSignals && data.budgetSignal.highestAmount !== null) {
      lines.push(`💰 <b>Techo presupuestal detectado:</b> ${formatCurrency(data.budgetSignal.highestAmount)}`);
    } else {
      lines.push("📊 <b>Techo presupuestal:</b> No localizado");
    }
  }
```

Hacer lo mismo en la rama de "sin documentos" (el primer `if` de la función, alrededor de línea 512), **antes** del bloque de errores:

```typescript
    if (data.budgetSignal !== undefined) {
      lines.push("");
      if (data.budgetSignal.hasSignals && data.budgetSignal.highestAmount !== null) {
        lines.push(`💰 <b>Techo presupuestal detectado:</b> ${formatCurrency(data.budgetSignal.highestAmount)}`);
      } else {
        lines.push("📊 <b>Techo presupuestal:</b> No localizado");
      }
    }
```

- [ ] **Step 5: Correr telegram.enriched tests**

```bash
npx jest src/alerts/__tests__/telegram.enriched.test.ts --no-coverage
```

Expected: PASS — todos.

### Cambios en `enrich-procurement.job.ts`

- [ ] **Step 6: Escribir tests nuevos para enrich-procurement.test.ts**

Agregar al test suite (después de los mocks existentes, agregar mocks para los nuevos módulos):

```typescript
// Al inicio del archivo de test, agregar estos mocks:
jest.mock("../../parsers/pdf-parser");
jest.mock("../../parsers/docx-parser");
jest.mock("../../parsers/xlsx-parser");
jest.mock("../../parsers/zip-parser");
jest.mock("../../services/budget-signal-extractor");

import { parsePdf } from "../../parsers/pdf-parser";
import { extractBudgetSignals } from "../../services/budget-signal-extractor";

const mockParsePdf = parsePdf as jest.MockedFunction<typeof parsePdf>;
const mockExtractBudget = extractBudgetSignals as jest.MockedFunction<typeof extractBudgetSignals>;
```

Y agregar estos dos casos de test nuevos dentro del `describe`:

```typescript
it("extrae señales de presupuesto de documentos descargados", async () => {
  // Setup: simular descarga exitosa de un PDF
  mockCollect.mockResolvedValue({
    documents: [{ fileUrl: "https://example.com/doc.pdf", fileName: "doc.pdf", fileType: "pdf", isDownloadable: true, documentTitle: "Bases", source: "ComprasMX", discoveredAt: "2026-05-07T00:00:00Z", documentHint: "bases" }],
    errors: [],
    collectorStatus: "ok",
    procedureNumber: "LPN-001",
    expedienteId: null,
    expedienteUrl: "https://example.com",
    scope: "MORELOS_ONLY",
    rawMetadata: {},
  });
  mockDownload.mockResolvedValue([{
    fileUrl: "https://example.com/doc.pdf",
    fileName: "doc.pdf",
    fileType: "pdf",
    downloadStatus: "ok",
    sha256Hash: "abc123",
    localPath: "/tmp/radar-docs/abc123.pdf",
    sizeBytes: 5000,
    errorMessage: null,
    downloadedAt: "2026-05-07T00:00:00Z",
  }]);
  mockParsePdf.mockResolvedValue({ text: "Presupuesto total $1,500,000.00 para el proyecto.", parseStatus: "ok", errors: [] });
  mockExtractBudget.mockReturnValue({ signals: [{ rawText: "$1,500,000.00", amount: 1500000, confidence: "alta" }], hasSignals: true, highestAmount: 1500000 });

  const result = await enrichProcurement({
    procurementId: "proc-1",
    procedureNumber: "LPN-001",
    expedienteId: null,
    sourceUrl: "https://example.com",
    title: "Mantenimiento",
    dependency: "Dependencia",
    scope: "MORELOS_ONLY",
    radarKey: "test-radar",
  });

  expect(result.status).toBe("success");
  expect(mockExtractBudget).toHaveBeenCalled();
});

it("no falla si parsers lanzan error", async () => {
  mockCollect.mockResolvedValue({
    documents: [{ fileUrl: "https://example.com/doc.pdf", fileName: "doc.pdf", fileType: "pdf", isDownloadable: true, documentTitle: "Bases", source: "ComprasMX", discoveredAt: "2026-05-07T00:00:00Z", documentHint: "bases" }],
    errors: [],
    collectorStatus: "ok",
    procedureNumber: "LPN-001",
    expedienteId: null,
    expedienteUrl: "https://example.com",
    scope: "MORELOS_ONLY",
    rawMetadata: {},
  });
  mockDownload.mockResolvedValue([{
    fileUrl: "https://example.com/doc.pdf",
    fileName: "doc.pdf",
    fileType: "pdf",
    downloadStatus: "ok",
    sha256Hash: "abc123",
    localPath: "/tmp/radar-docs/abc123.pdf",
    sizeBytes: 5000,
    errorMessage: null,
    downloadedAt: "2026-05-07T00:00:00Z",
  }]);
  mockParsePdf.mockRejectedValue(new Error("PDF corrupto"));
  mockExtractBudget.mockReturnValue({ signals: [], hasSignals: false, highestAmount: null });

  await expect(enrichProcurement({
    procurementId: "proc-2",
    procedureNumber: "LPN-002",
    expedienteId: null,
    sourceUrl: "https://example.com",
    title: "Mantenimiento",
    dependency: "Dependencia",
    scope: "MORELOS_ONLY",
    radarKey: "test-radar",
  })).resolves.toBeDefined();
});
```

- [ ] **Step 7: Verificar que los nuevos tests fallan**

```bash
npx jest src/jobs/__tests__/enrich-procurement.test.ts --no-coverage
```

Expected: 2 nuevos tests failing (mockParsePdf/mockExtractBudget no están en uso aún).

- [ ] **Step 8: Modificar `enrich-procurement.job.ts` — agregar imports**

Al inicio del archivo, agregar estos imports después de las importaciones existentes:

```typescript
import { parsePdf } from "../parsers/pdf-parser";
import { parseDocx } from "../parsers/docx-parser";
import { parseXlsx } from "../parsers/xlsx-parser";
import { parseZip } from "../parsers/zip-parser";
import { extractBudgetSignals } from "../services/budget-signal-extractor";
import type { BudgetSignalResult } from "../services/budget-signal-extractor";
```

- [ ] **Step 9: Agregar helper `parseDocumentFile` antes de `enrichProcurement`**

```typescript
async function parseDocumentFile(
  localPath: string,
  fileType: string,
): Promise<string> {
  if (fileType === "pdf") {
    const r = await parsePdf(localPath);
    return r.text;
  }
  if (fileType === "docx") {
    const r = await parseDocx(localPath);
    return r.text;
  }
  if (fileType === "xlsx") {
    const r = await parseXlsx(localPath);
    return r.text;
  }
  if (fileType === "zip") {
    const r = await parseZip(localPath);
    return r.files
      .filter((f) => f.parseResult !== null)
      .map((f) => f.parseResult!.text)
      .join("\n");
  }
  return "";
}
```

- [ ] **Step 10: Agregar paso 5 (parse + budget) en `enrichProcurement`**

En `enrichProcurement`, después del bloque de determinación de `status` (paso 5 actual) y **antes** del bloque "6. Segundo mensaje Telegram", agregar:

```typescript
    // 5b. Parsear documentos descargados y extraer señal de presupuesto
    const allTexts: string[] = [];
    for (let i = 0; i < downloadable.length; i++) {
      const dlResult = downloadResults[i];
      if (
        (dlResult.downloadStatus === "ok" || dlResult.downloadStatus === "skipped_duplicate") &&
        dlResult.localPath
      ) {
        try {
          const text = await parseDocumentFile(dlResult.localPath, dlResult.fileType);
          if (text) allTexts.push(text);
        } catch (parseErr) {
          log.warn({ err: parseErr, localPath: dlResult.localPath }, "⚠️ Error parseando documento");
        }
      }
    }
    const combinedText = allTexts.join("\n\n");
    const budgetSignal: BudgetSignalResult = extractBudgetSignals(combinedText);
```

- [ ] **Step 11: Pasar `budgetSignal` a `formatEnrichedAlert`**

En el bloque "6. Segundo mensaje Telegram", modificar la llamada a `formatEnrichedAlert` para incluir `budgetSignal`:

```typescript
    const enrichedMessage = formatEnrichedAlert({
      procedureNumber: input.procedureNumber ?? "N/D",
      expedienteId: input.expedienteId,
      title: input.title,
      dependency: input.dependency,
      scope: input.scope,
      documentsFound: documents,
      documentsDownloaded: downloadResults,
      errors,
      budgetSignal: { hasSignals: budgetSignal.hasSignals, highestAmount: budgetSignal.highestAmount },
    });
```

- [ ] **Step 12: Correr todos los tests**

```bash
npm test -- --no-coverage
```

Expected: ≥200 tests, 0 failing.

- [ ] **Step 13: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 14: Build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 15: Commit**

```bash
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX add apps/worker/src/jobs/enrich-procurement.job.ts apps/worker/src/jobs/__tests__/enrich-procurement.test.ts apps/worker/src/alerts/telegram.alerts.ts apps/worker/src/alerts/__tests__/telegram.enriched.test.ts
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX commit -m "feat: E-Integration — parsers y presupuesto integrados en enrich-procurement"
```

- [ ] **Step 16: Push**

```bash
git -C /Users/kennethjts/Claude\ Code\ Ultraplan/Radar-Licitaciones-MX push origin main
```

---

## Summary

| Tarea | Archivos nuevos | Tests nuevos |
|-------|----------------|--------------|
| E0 (types + deps) | `src/parsers/types.ts` | — |
| E1 (pdf) | `src/parsers/pdf-parser.ts` + test | 5 |
| E2 (docx) | `src/parsers/docx-parser.ts` + test | 4 |
| E3 (xlsx) | `src/parsers/xlsx-parser.ts` + test | 5 |
| E4 (zip) | `src/parsers/zip-parser.ts` + test | 5 |
| E5 (classifier) | `src/services/document-classifier.ts` + test | 16 |
| E6 (budget) | `src/services/budget-signal-extractor.ts` + test | 7 |
| E-Integration | mods a 4 archivos existentes | +5 |
| **Total** | **9 archivos nuevos** | **~47 tests nuevos** |

Total esperado post-Fase E: **≥207 tests**.
