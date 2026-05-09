# Fase D — Enrichment Genérico OSINT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un pipeline de enriquecimiento OSINT no bloqueante que, después de cada alerta Telegram, abre el expediente de ComprasMX con Playwright, descarga documentos públicos y envía un segundo mensaje estructurado con el contenido encontrado.

**Architecture:** El pipeline sigue el patrón "fire and forget" desde `collect.job.ts`. D1 (`enrich-procurement.job.ts`) orquesta D2 (collector Playwright) y D3 (downloader HTTP), luego D4 formatea el mensaje Telegram. Los tipos compartidos (`DocumentLink`, `DownloadResult`) se importan desde los módulos que los definen. Todas las funciones capturan errores y nunca hacen throw al caller.

**Tech Stack:** TypeScript strict, Playwright (BrowserManager existente), axios (ya en package.json), Node.js `crypto` + `fs`, pino logger, jest + ts-jest para tests.

---

## File Map

| Acción | Ruta |
|--------|------|
| Crear | `src/collectors/comprasmx-detail/index.ts` |
| Crear | `src/collectors/comprasmx-detail/__tests__/index.test.ts` |
| Crear | `src/services/document-downloader.ts` |
| Crear | `src/services/__tests__/document-downloader.test.ts` |
| Crear | `src/jobs/enrich-procurement.job.ts` |
| Crear | `src/jobs/__tests__/enrich-procurement.test.ts` |
| Modificar | `src/alerts/telegram.alerts.ts` |
| Crear | `src/alerts/__tests__/telegram.enriched.test.ts` |
| Modificar | `src/jobs/collect.job.ts` |

---

## Task D2: src/collectors/comprasmx-detail/index.ts

**Files:**
- Create: `src/collectors/comprasmx-detail/index.ts`
- Test: `src/collectors/comprasmx-detail/__tests__/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/collectors/comprasmx-detail/__tests__/index.test.ts`:

```typescript
import {
  classifyDocumentHint,
  extractFileType,
} from "../index";

describe("classifyDocumentHint", () => {
  it("filename con 'convocatoria' → convocatoria", () => {
    expect(classifyDocumentHint("convocatoria_bases.pdf", "Bases del procedimiento")).toBe("convocatoria");
  });

  it("title con 'técnico' → anexo_tecnico", () => {
    expect(classifyDocumentHint(null, "Anexo Técnico TDR")).toBe("anexo_tecnico");
  });

  it("title con 'económico' → anexo_economico", () => {
    expect(classifyDocumentHint(null, "Catálogo de conceptos y precios")).toBe("anexo_economico");
  });

  it("filename con 'fallo' → fallo", () => {
    expect(classifyDocumentHint("fallo_adjudicacion.pdf", "Acto del fallo")).toBe("fallo");
  });

  it("texto desconocido → otro", () => {
    expect(classifyDocumentHint(null, "Documento sin clasificar")).toBe("otro");
  });

  it("filename con 'contrato' → contrato", () => {
    expect(classifyDocumentHint("modelo_contrato.docx", "Modelo de contrato")).toBe("contrato");
  });

  it("title con 'legal' → anexo_legal", () => {
    expect(classifyDocumentHint(null, "Requisitos jurídicos")).toBe("anexo_legal");
  });
});

describe("extractFileType", () => {
  it("url con .pdf → pdf", () => {
    expect(extractFileType("https://example.com/doc.pdf")).toBe("pdf");
  });

  it("url con .docx y query string → docx", () => {
    expect(extractFileType("https://example.com/file.docx?v=1")).toBe("docx");
  });

  it("url sin extensión conocida → other", () => {
    expect(extractFileType("https://example.com/descarga")).toBe("other");
  });

  it("url con .xlsx → xlsx", () => {
    expect(extractFileType("https://example.com/catalogo.xlsx")).toBe("xlsx");
  });

  it("url con .zip → zip", () => {
    expect(extractFileType("https://example.com/bases.zip")).toBe("zip");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/worker && npm test -- --testPathPattern="comprasmx-detail"
```

Expected: FAIL with "Cannot find module '../index'"

- [ ] **Step 3: Implement src/collectors/comprasmx-detail/index.ts**

```typescript
/**
 * COMPRASMX DETAIL COLLECTOR — Abre el expediente público y extrae DocumentLinks.
 * Usa BrowserManager.withContext (Playwright) para renderizar la SPA Angular.
 */
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { BrowserManager } from "../comprasmx/browser.manager";

const log = createModuleLogger("comprasmx-detail-collector");

const RATE_LIMIT_MS = 3_000;
const LOAD_TIMEOUT_MS = 15_000;

// ── Tipos ──────────────────────────────────────────────────────────────────────

export type FileType = "pdf" | "docx" | "xlsx" | "zip" | "other";
export type DocumentHint =
  | "convocatoria"
  | "anexo_tecnico"
  | "anexo_economico"
  | "anexo_legal"
  | "fallo"
  | "contrato"
  | "otro";

export interface DocumentLink {
  documentTitle: string;
  fileName: string | null;
  fileUrl: string;
  fileType: FileType;
  source: string;
  discoveredAt: string;
  documentHint: DocumentHint | null;
  isDownloadable: boolean;
}

export interface DetailCollectorInput {
  sourceUrl: string;
  procedureNumber: string | null;
  expedienteId: string | null;
  scope: string;
}

export interface DetailCollectorResult {
  procedureNumber: string | null;
  expedienteId: string | null;
  source: "ComprasMX";
  expedienteUrl: string;
  scope: string;
  documents: DocumentLink[];
  rawMetadata: Record<string, unknown>;
  collectorStatus: "ok" | "partial" | "no_documents" | "blocked" | "error";
  errors: string[];
}

// ── Helpers puros (exportados para tests) ─────────────────────────────────────

/**
 * Clasifica un documento a partir del nombre de archivo y título del link.
 */
export function classifyDocumentHint(
  fileName: string | null,
  title: string,
): DocumentHint {
  const text = `${fileName ?? ""} ${title}`.toLowerCase();
  if (/convocatoria|bases|invitaci[oó]n/.test(text)) return "convocatoria";
  if (/t[eé]cnico|tdr|t[eé]rminos/.test(text)) return "anexo_tecnico";
  if (/econ[oó]mico|precios|cat[aá]logo|conceptos/.test(text))
    return "anexo_economico";
  if (/legal|jur[ií]dico|requisitos/.test(text)) return "anexo_legal";
  if (/fallo|dictamen|adjudicaci[oó]n/.test(text)) return "fallo";
  if (/contrato|modelo|convenio/.test(text)) return "contrato";
  return "otro";
}

/**
 * Detecta el tipo de archivo desde la URL.
 */
export function extractFileType(url: string): FileType {
  const ext =
    url
      .split("?")[0]
      .split(".")
      .pop()
      ?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "docx";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "zip") return "zip";
  return "other";
}

// ── Función principal ──────────────────────────────────────────────────────────

/**
 * Abre el expediente en ComprasMX con Playwright y extrae todos los DocumentLinks.
 * Nunca hace throw — los errores se registran en el campo `errors` del resultado.
 */
export async function collectComprasMxDetail(
  input: DetailCollectorInput,
): Promise<DetailCollectorResult> {
  const baseResult: DetailCollectorResult = {
    procedureNumber: input.procedureNumber,
    expedienteId: input.expedienteId,
    source: "ComprasMX",
    expedienteUrl: input.sourceUrl,
    scope: input.scope,
    documents: [],
    rawMetadata: {},
    collectorStatus: "error",
    errors: [],
  };

  try {
    const documents = await BrowserManager.withContext(
      async (page) => {
        log.info(
          { url: input.sourceUrl, procedureNumber: input.procedureNumber },
          "🔍 Navigating to expediente...",
        );

        await page.goto(input.sourceUrl, {
          waitUntil: "domcontentloaded",
          timeout: LOAD_TIMEOUT_MS,
        });

        // Esperar que la SPA Angular cargue contenido
        await page
          .waitForSelector("a[href], button", { timeout: LOAD_TIMEOUT_MS })
          .catch(() => {
            // Si no hay links/botones, continuar igual
          });

        // Rate limit para no sobrecargar el servidor
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));

        const discoveredAt = nowISO();
        const found: DocumentLink[] = [];

        // Buscar todos los <a> con href que contengan extensiones descargables
        const linkHandles = await page.$$("a[href]");

        for (const handle of linkHandles) {
          try {
            const href = await handle.getAttribute("href");
            if (!href) continue;

            const title = ((await handle.innerText().catch(() => "")) || "").trim();
            const fileType = extractFileType(href);
            const isDownloadable = fileType !== "other";

            // Incluir si es descargable O si el título contiene palabras clave de documentos
            const hasDocumentKeyword =
              /convocatoria|anexo|bases|aclaraciones|fallo|contrato|modelo|cat[aá]logo/i.test(
                title,
              );

            if (!isDownloadable && !hasDocumentKeyword) continue;

            // Construir URL absoluta si es relativa
            const fileUrl = href.startsWith("http")
              ? href
              : new URL(href, input.sourceUrl).toString();

            const fileName = fileUrl
              .split("?")[0]
              .split("/")
              .pop() ?? null;

            const documentHint = classifyDocumentHint(fileName, title);

            found.push({
              documentTitle: title || fileName || "Documento sin título",
              fileName: fileName || null,
              fileUrl,
              fileType,
              source: "ComprasMX",
              discoveredAt,
              documentHint,
              isDownloadable,
            });
          } catch {
            // link individual falla → continuar
          }
        }

        return found;
      },
      { timeoutMs: LOAD_TIMEOUT_MS + RATE_LIMIT_MS + 5_000 },
    );

    if (documents.length === 0) {
      return { ...baseResult, collectorStatus: "no_documents", errors: [] };
    }

    return {
      ...baseResult,
      documents,
      collectorStatus: "ok",
      errors: [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, url: input.sourceUrl }, "❌ collectComprasMxDetail error");
    return {
      ...baseResult,
      collectorStatus: "error",
      errors: [msg],
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && npm test -- --testPathPattern="comprasmx-detail"
```

Expected: 12 tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd apps/worker && npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd apps/worker && git add src/collectors/comprasmx-detail/ && git commit -m "feat(D2): collectComprasMxDetail — Playwright document discovery desde expediente ComprasMX"
```

---

## Task D3: src/services/document-downloader.ts

**Files:**
- Create: `src/services/document-downloader.ts`
- Test: `src/services/__tests__/document-downloader.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/services/__tests__/document-downloader.test.ts`:

```typescript
import axios from "axios";
import * as fs from "fs";
import { downloadDocument, downloadDocuments } from "../document-downloader";
import type { DocumentLink } from "../../collectors/comprasmx-detail/index";

jest.mock("axios");
jest.mock("fs");

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;

function makeDocLink(overrides: Partial<DocumentLink> = {}): DocumentLink {
  return {
    documentTitle: "Bases del procedimiento",
    fileName: "bases.pdf",
    fileUrl: "https://example.com/bases.pdf",
    fileType: "pdf",
    source: "ComprasMX",
    discoveredAt: "2026-05-07T00:00:00.000Z",
    documentHint: "convocatoria",
    isDownloadable: true,
    ...overrides,
  };
}

describe("downloadDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.mkdirSync.mockImplementation(() => undefined as unknown as string);
    mockedFs.writeFileSync.mockImplementation(() => undefined);
  });

  it("descarga PDF exitosamente → ok", async () => {
    const content = Buffer.from("PDF content here");
    mockedAxios.get.mockResolvedValue({
      data: content,
      headers: { "content-length": String(content.length) },
      status: 200,
    });

    const result = await downloadDocument(makeDocLink());

    expect(result.downloadStatus).toBe("ok");
    expect(result.sha256Hash).toBeTruthy();
    expect(result.sizeBytes).toBe(content.length);
    expect(result.localPath).toContain("/tmp/radar-docs/");
  });

  it("Content-Length supera 20MB → too_large", async () => {
    mockedAxios.get.mockResolvedValue({
      data: Buffer.alloc(0),
      headers: { "content-length": String(21 * 1024 * 1024) },
      status: 200,
    });

    const result = await downloadDocument(makeDocLink());

    expect(result.downloadStatus).toBe("too_large");
    expect(result.localPath).toBeNull();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("sha256 ya existe en disco → skipped_duplicate", async () => {
    const content = Buffer.from("PDF content here");
    mockedAxios.get.mockResolvedValue({
      data: content,
      headers: { "content-length": String(content.length) },
      status: 200,
    });
    // Primera vez: no existe; segunda vez: sí existe
    mockedFs.existsSync.mockReturnValue(true);

    const result = await downloadDocument(makeDocLink());

    expect(result.downloadStatus).toBe("skipped_duplicate");
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });

  it("axios lanza error → failed", async () => {
    mockedAxios.get.mockRejectedValue(new Error("Network error"));

    const result = await downloadDocument(makeDocLink({ 
      fileUrl: "https://example.com/bases.pdf",
      fileType: "pdf"
    }));

    expect(result.downloadStatus).toBe("failed");
    expect(result.errorMessage).toContain("Network error");
    expect(result.localPath).toBeNull();
  });

  it("fileType 'other' → failed (tipo no soportado)", async () => {
    const result = await downloadDocument(
      makeDocLink({ fileType: "other", fileName: "doc.html" }),
    );

    expect(result.downloadStatus).toBe("failed");
    expect(result.errorMessage).toContain("tipo no soportado");
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});

describe("downloadDocuments (batch)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.mkdirSync.mockImplementation(() => undefined as unknown as string);
    mockedFs.writeFileSync.mockImplementation(() => undefined);
  });

  it("batch con uno ok y uno failed → retorna los dos resultados", async () => {
    const content = Buffer.from("data");
    mockedAxios.get
      .mockResolvedValueOnce({ data: content, headers: { "content-length": "4" }, status: 200 })
      .mockRejectedValueOnce(new Error("Timeout"));

    const results = await downloadDocuments([
      makeDocLink({ fileUrl: "https://example.com/a.pdf" }),
      makeDocLink({ fileUrl: "https://example.com/b.pdf" }),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].downloadStatus).toBe("ok");
    expect(results[1].downloadStatus).toBe("failed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/worker && npm test -- --testPathPattern="document-downloader"
```

Expected: FAIL with "Cannot find module '../document-downloader'"

- [ ] **Step 3: Implement src/services/document-downloader.ts**

```typescript
/**
 * DOCUMENT DOWNLOADER — Descarga documentos públicos de licitaciones.
 * Guarda en /tmp/radar-docs/{sha256}.{ext}, deduplica por hash.
 * Nunca hace throw al caller — errores en `downloadStatus` + `errorMessage`.
 */
import axios from "axios";
import * as fs from "fs";
import { createHash } from "crypto";
import { createModuleLogger } from "../core/logger";
import { nowISO } from "../core/time";
import type { DocumentLink } from "../collectors/comprasmx-detail/index";

const log = createModuleLogger("document-downloader");

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const DOWNLOAD_TIMEOUT_MS = 30_000;
const RATE_LIMIT_MS = 2_000;
const DOWNLOAD_DIR = "/tmp/radar-docs";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DOWNLOADABLE_TYPES = new Set(["pdf", "docx", "xlsx", "zip"]);

export interface DownloadResult {
  fileUrl: string;
  fileName: string;
  fileType: string;
  sha256Hash: string | null;
  downloadStatus: "ok" | "skipped_duplicate" | "failed" | "too_large";
  sizeBytes: number | null;
  localPath: string | null;
  errorMessage: string | null;
  downloadedAt: string;
}

function ensureDownloadDir(): void {
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }
}

export async function downloadDocument(doc: DocumentLink): Promise<DownloadResult> {
  const base: DownloadResult = {
    fileUrl: doc.fileUrl,
    fileName: doc.fileName ?? doc.fileUrl.split("/").pop() ?? "file",
    fileType: doc.fileType,
    sha256Hash: null,
    downloadStatus: "failed",
    sizeBytes: null,
    localPath: null,
    errorMessage: null,
    downloadedAt: nowISO(),
  };

  // 1. Validar tipo de archivo
  if (!DOWNLOADABLE_TYPES.has(doc.fileType)) {
    return {
      ...base,
      downloadStatus: "failed",
      errorMessage: `tipo no soportado: ${doc.fileType}`,
    };
  }

  // 2. Verificar Content-Length antes de descargar (HEAD request no siempre disponible)
  // Lo verificamos leyendo el header en la respuesta GET completa.
  // Primero hacemos una verificación rápida con el header si lo podemos leer.
  try {
    // Intento de HEAD para obtener Content-Length sin descargar
    const headResponse = await axios.head(doc.fileUrl, {
      timeout: 10_000,
      headers: { "User-Agent": USER_AGENT },
    }).catch(() => null);

    if (headResponse) {
      const contentLengthHeader = headResponse.headers["content-length"];
      if (contentLengthHeader) {
        const size = parseInt(String(contentLengthHeader), 10);
        if (!isNaN(size) && size > MAX_SIZE_BYTES) {
          return { ...base, downloadStatus: "too_large", sizeBytes: size };
        }
      }
    }

    // 3. Descargar archivo
    const response = await axios.get<Buffer>(doc.fileUrl, {
      responseType: "arraybuffer",
      timeout: DOWNLOAD_TIMEOUT_MS,
      headers: { "User-Agent": USER_AGENT },
      maxRedirects: 5,
    });

    const buffer = Buffer.from(response.data as ArrayBuffer);

    // 4. Verificar tamaño real post-descarga
    if (buffer.length > MAX_SIZE_BYTES) {
      return { ...base, downloadStatus: "too_large", sizeBytes: buffer.length };
    }

    // 5. Calcular sha256
    const sha256Hash = createHash("sha256").update(buffer).digest("hex");

    // 6. Verificar duplicado
    const ext = doc.fileType === "other" ? "bin" : doc.fileType;
    const localPath = `${DOWNLOAD_DIR}/${sha256Hash}.${ext}`;

    if (fs.existsSync(localPath)) {
      return {
        ...base,
        downloadStatus: "skipped_duplicate",
        sha256Hash,
        sizeBytes: buffer.length,
        localPath,
      };
    }

    // 7. Escribir a disco
    ensureDownloadDir();
    fs.writeFileSync(localPath, buffer);

    log.info(
      { fileUrl: doc.fileUrl, sha256Hash, sizeBytes: buffer.length, localPath },
      "✅ Documento descargado",
    );

    return {
      ...base,
      downloadStatus: "ok",
      sha256Hash,
      sizeBytes: buffer.length,
      localPath,
      errorMessage: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err, fileUrl: doc.fileUrl }, "❌ Error descargando documento");
    return { ...base, downloadStatus: "failed", errorMessage: msg };
  }
}

export async function downloadDocuments(
  docs: DocumentLink[],
): Promise<DownloadResult[]> {
  const results: DownloadResult[] = [];
  const isTest = process.env.NODE_ENV === "test";

  for (const doc of docs) {
    const result = await downloadDocument(doc);
    results.push(result);

    // Rate limit entre descargas (omitir en tests)
    if (!isTest && docs.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));
    }
  }

  return results;
}
```

**Nota sobre la prueba `too_large`:** En la implementación, el check de tamaño usa el HEAD request. Sin embargo, en los tests mockamos `axios.get` (no `axios.head`). Para que el test "Content-Length supera 20MB → too_large" funcione, necesitamos ajustar: el mock de axios.get devuelve headers con content-length > 20MB, y el check se hace en el response del GET (no en HEAD). Cambia la implementación para verificar el header `content-length` del response GET directamente, sin hacer HEAD request previo (más simple y testeable):

```typescript
// Reemplazar toda la sección de HEAD + GET por:
const response = await axios.get<Buffer>(doc.fileUrl, {
  responseType: "arraybuffer",
  timeout: DOWNLOAD_TIMEOUT_MS,
  headers: { "User-Agent": USER_AGENT },
  maxRedirects: 5,
});

// Verificar Content-Length del response header ANTES de procesar el buffer
const contentLengthHeader = response.headers?.["content-length"];
if (contentLengthHeader) {
  const declaredSize = parseInt(String(contentLengthHeader), 10);
  if (!isNaN(declaredSize) && declaredSize > MAX_SIZE_BYTES) {
    return { ...base, downloadStatus: "too_large", sizeBytes: declaredSize };
  }
}

const buffer = Buffer.from(response.data as ArrayBuffer);

// Verificar tamaño real post-descarga
if (buffer.length > MAX_SIZE_BYTES) {
  return { ...base, downloadStatus: "too_large", sizeBytes: buffer.length };
}
```

La implementación final para `downloadDocument` (sin HEAD request, solo GET):

```typescript
export async function downloadDocument(doc: DocumentLink): Promise<DownloadResult> {
  const base: DownloadResult = {
    fileUrl: doc.fileUrl,
    fileName: doc.fileName ?? doc.fileUrl.split("/").pop() ?? "file",
    fileType: doc.fileType,
    sha256Hash: null,
    downloadStatus: "failed",
    sizeBytes: null,
    localPath: null,
    errorMessage: null,
    downloadedAt: nowISO(),
  };

  // 1. Validar tipo de archivo
  if (!DOWNLOADABLE_TYPES.has(doc.fileType)) {
    return {
      ...base,
      downloadStatus: "failed",
      errorMessage: `tipo no soportado: ${doc.fileType}`,
    };
  }

  try {
    // 2. Verificar Content-Length via HEAD (best-effort)
    const headResp = await axios.head(doc.fileUrl, {
      timeout: 10_000,
      headers: { "User-Agent": USER_AGENT },
    }).catch(() => null);

    const clHeader = headResp?.headers?.["content-length"];
    if (clHeader) {
      const declaredSize = parseInt(String(clHeader), 10);
      if (!isNaN(declaredSize) && declaredSize > MAX_SIZE_BYTES) {
        return { ...base, downloadStatus: "too_large", sizeBytes: declaredSize };
      }
    }

    // 3. Descargar
    const response = await axios.get<Buffer>(doc.fileUrl, {
      responseType: "arraybuffer",
      timeout: DOWNLOAD_TIMEOUT_MS,
      headers: { "User-Agent": USER_AGENT },
      maxRedirects: 5,
    });

    const buffer = Buffer.from(response.data as ArrayBuffer);

    if (buffer.length > MAX_SIZE_BYTES) {
      return { ...base, downloadStatus: "too_large", sizeBytes: buffer.length };
    }

    // 4. SHA256 + dedup
    const sha256Hash = createHash("sha256").update(buffer).digest("hex");
    const ext = doc.fileType;
    const localPath = `${DOWNLOAD_DIR}/${sha256Hash}.${ext}`;

    if (fs.existsSync(localPath)) {
      return { ...base, downloadStatus: "skipped_duplicate", sha256Hash, sizeBytes: buffer.length, localPath };
    }

    // 5. Escribir
    ensureDownloadDir();
    fs.writeFileSync(localPath, buffer);

    log.info({ fileUrl: doc.fileUrl, sha256Hash, sizeBytes: buffer.length }, "✅ Descargado");

    return { ...base, downloadStatus: "ok", sha256Hash, sizeBytes: buffer.length, localPath, errorMessage: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err, fileUrl: doc.fileUrl }, "❌ Error descargando");
    return { ...base, downloadStatus: "failed", errorMessage: msg };
  }
}
```

**Ajuste del test `too_large`:** Como usamos HEAD (best-effort), el test debe mockear `axios.head`:

```typescript
it("Content-Length supera 20MB → too_large", async () => {
  mockedAxios.head.mockResolvedValue({
    headers: { "content-length": String(21 * 1024 * 1024) },
    status: 200,
  });

  const result = await downloadDocument(makeDocLink());

  expect(result.downloadStatus).toBe("too_large");
  expect(result.localPath).toBeNull();
  expect(mockedAxios.get).not.toHaveBeenCalled();
});
```

Y el test `axios lanza error → failed` debe mockear HEAD (que falle silenciosamente con null) y GET que lance:

```typescript
it("axios lanza error → failed", async () => {
  mockedAxios.head.mockRejectedValue(new Error("head fail")); // HEAD falla → null → OK
  mockedAxios.get.mockRejectedValue(new Error("Network error"));

  const result = await downloadDocument(makeDocLink({ fileType: "pdf" }));

  expect(result.downloadStatus).toBe("failed");
  expect(result.errorMessage).toContain("Network error");
});
```

Y el test `sha256 ya existe → skipped_duplicate` mockea HEAD sin content-length, GET con content OK:

```typescript
it("sha256 ya existe en disco → skipped_duplicate", async () => {
  const content = Buffer.from("PDF content here");
  mockedAxios.head.mockResolvedValue({ headers: {}, status: 200 });
  mockedAxios.get.mockResolvedValue({
    data: content,
    headers: {},
    status: 200,
  });
  mockedFs.existsSync.mockReturnValue(true); // ya existe

  const result = await downloadDocument(makeDocLink());

  expect(result.downloadStatus).toBe("skipped_duplicate");
  expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && npm test -- --testPathPattern="document-downloader"
```

Expected: 6 tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd apps/worker && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
cd apps/worker && git add src/services/document-downloader.ts src/services/__tests__/document-downloader.test.ts && git commit -m "feat(D3): document-downloader — descarga HTTP con dedup sha256, rate limit, 20MB cap"
```

---

## Task D1: src/jobs/enrich-procurement.job.ts

**Files:**
- Create: `src/jobs/enrich-procurement.job.ts`
- Test: `src/jobs/__tests__/enrich-procurement.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/jobs/__tests__/enrich-procurement.test.ts`:

```typescript
import { enrichProcurement } from "../enrich-procurement.job";
import type { EnrichmentInput } from "../enrich-procurement.job";

// Mock D2 y D3
jest.mock("../../collectors/comprasmx-detail/index");
jest.mock("../../services/document-downloader");
jest.mock("../../alerts/telegram.alerts");

import { collectComprasMxDetail } from "../../collectors/comprasmx-detail/index";
import { downloadDocuments } from "../../services/document-downloader";
import { sendTelegramMessage } from "../../alerts/telegram.alerts";

const mockedCollect = collectComprasMxDetail as jest.MockedFunction<typeof collectComprasMxDetail>;
const mockedDownload = downloadDocuments as jest.MockedFunction<typeof downloadDocuments>;
const mockedSend = sendTelegramMessage as jest.MockedFunction<typeof sendTelegramMessage>;

const baseInput: EnrichmentInput = {
  procurementId: "proc-001",
  procedureNumber: "CAPUFE-2026-001",
  expedienteId: "EXP-001",
  sourceUrl: "https://comprasmx.buengobierno.gob.mx/sitiopublico/#/detalle/uuid/procedimiento",
  title: "Mantenimiento de casetas",
  dependency: "CAPUFE",
  scope: "NATIONAL_CAPUFE_DESIERTA",
  radarKey: "capufe-oportunidades",
};

describe("enrichProcurement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSend.mockResolvedValue(12345);
  });

  it("sourceUrl null → skipped_no_documents, sin llamar a collector", async () => {
    const result = await enrichProcurement({ ...baseInput, sourceUrl: null });

    expect(result.status).toBe("skipped_no_documents");
    expect(result.documentsFound).toBe(0);
    expect(result.documentsDownloaded).toBe(0);
    expect(mockedCollect).not.toHaveBeenCalled();
  });

  it("collector devuelve no_documents → skipped_no_documents", async () => {
    mockedCollect.mockResolvedValue({
      procedureNumber: "CAPUFE-2026-001",
      expedienteId: "EXP-001",
      source: "ComprasMX",
      expedienteUrl: baseInput.sourceUrl!,
      scope: "NATIONAL_CAPUFE_DESIERTA",
      documents: [],
      rawMetadata: {},
      collectorStatus: "no_documents",
      errors: [],
    });

    const result = await enrichProcurement(baseInput);

    expect(result.status).toBe("skipped_no_documents");
    expect(result.documentsFound).toBe(0);
    expect(mockedDownload).not.toHaveBeenCalled();
  });

  it("todos los documentos descargan OK → success", async () => {
    mockedCollect.mockResolvedValue({
      procedureNumber: "CAPUFE-2026-001",
      expedienteId: "EXP-001",
      source: "ComprasMX",
      expedienteUrl: baseInput.sourceUrl!,
      scope: "NATIONAL_CAPUFE_DESIERTA",
      documents: [
        {
          documentTitle: "Bases",
          fileName: "bases.pdf",
          fileUrl: "https://example.com/bases.pdf",
          fileType: "pdf",
          source: "ComprasMX",
          discoveredAt: "2026-05-07T00:00:00Z",
          documentHint: "convocatoria",
          isDownloadable: true,
        },
      ],
      rawMetadata: {},
      collectorStatus: "ok",
      errors: [],
    });

    mockedDownload.mockResolvedValue([
      {
        fileUrl: "https://example.com/bases.pdf",
        fileName: "bases.pdf",
        fileType: "pdf",
        sha256Hash: "abc123",
        downloadStatus: "ok",
        sizeBytes: 1024,
        localPath: "/tmp/radar-docs/abc123.pdf",
        errorMessage: null,
        downloadedAt: "2026-05-07T00:00:00Z",
      },
    ]);

    const result = await enrichProcurement(baseInput);

    expect(result.status).toBe("success");
    expect(result.documentsFound).toBe(1);
    expect(result.documentsDownloaded).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("algunas descargas fallan → partial_success", async () => {
    mockedCollect.mockResolvedValue({
      procedureNumber: "CAPUFE-2026-001",
      expedienteId: "EXP-001",
      source: "ComprasMX",
      expedienteUrl: baseInput.sourceUrl!,
      scope: "NATIONAL_CAPUFE_DESIERTA",
      documents: [
        {
          documentTitle: "Bases",
          fileName: "bases.pdf",
          fileUrl: "https://example.com/bases.pdf",
          fileType: "pdf",
          source: "ComprasMX",
          discoveredAt: "2026-05-07T00:00:00Z",
          documentHint: "convocatoria",
          isDownloadable: true,
        },
        {
          documentTitle: "Anexo",
          fileName: "anexo.pdf",
          fileUrl: "https://example.com/anexo.pdf",
          fileType: "pdf",
          source: "ComprasMX",
          discoveredAt: "2026-05-07T00:00:00Z",
          documentHint: "anexo_tecnico",
          isDownloadable: true,
        },
      ],
      rawMetadata: {},
      collectorStatus: "ok",
      errors: [],
    });

    mockedDownload.mockResolvedValue([
      {
        fileUrl: "https://example.com/bases.pdf",
        fileName: "bases.pdf",
        fileType: "pdf",
        sha256Hash: "abc123",
        downloadStatus: "ok",
        sizeBytes: 1024,
        localPath: "/tmp/radar-docs/abc123.pdf",
        errorMessage: null,
        downloadedAt: "2026-05-07T00:00:00Z",
      },
      {
        fileUrl: "https://example.com/anexo.pdf",
        fileName: "anexo.pdf",
        fileType: "pdf",
        sha256Hash: null,
        downloadStatus: "failed",
        sizeBytes: null,
        localPath: null,
        errorMessage: "Timeout",
        downloadedAt: "2026-05-07T00:00:00Z",
      },
    ]);

    const result = await enrichProcurement(baseInput);

    expect(result.status).toBe("partial_success");
    expect(result.documentsFound).toBe(2);
    expect(result.documentsDownloaded).toBe(1);
  });

  it("todos los documentos fallan al descargar → failed", async () => {
    mockedCollect.mockResolvedValue({
      procedureNumber: "CAPUFE-2026-001",
      expedienteId: "EXP-001",
      source: "ComprasMX",
      expedienteUrl: baseInput.sourceUrl!,
      scope: "NATIONAL_CAPUFE_DESIERTA",
      documents: [
        {
          documentTitle: "Bases",
          fileName: "bases.pdf",
          fileUrl: "https://example.com/bases.pdf",
          fileType: "pdf",
          source: "ComprasMX",
          discoveredAt: "2026-05-07T00:00:00Z",
          documentHint: "convocatoria",
          isDownloadable: true,
        },
      ],
      rawMetadata: {},
      collectorStatus: "ok",
      errors: [],
    });

    mockedDownload.mockResolvedValue([
      {
        fileUrl: "https://example.com/bases.pdf",
        fileName: "bases.pdf",
        fileType: "pdf",
        sha256Hash: null,
        downloadStatus: "failed",
        sizeBytes: null,
        localPath: null,
        errorMessage: "Connection refused",
        downloadedAt: "2026-05-07T00:00:00Z",
      },
    ]);

    const result = await enrichProcurement(baseInput);

    expect(result.status).toBe("failed");
    expect(result.documentsFound).toBe(1);
    expect(result.documentsDownloaded).toBe(0);
  });

  it("collector lanza excepción → failed sin re-throw", async () => {
    mockedCollect.mockRejectedValue(new Error("Playwright crashed"));

    const result = await enrichProcurement(baseInput);

    expect(result.status).toBe("failed");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Playwright crashed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/worker && npm test -- --testPathPattern="enrich-procurement"
```

Expected: FAIL with "Cannot find module '../enrich-procurement.job'"

- [ ] **Step 3: Implement src/jobs/enrich-procurement.job.ts**

```typescript
/**
 * ENRICH PROCUREMENT JOB — Orquesta el pipeline de enriquecimiento OSINT.
 *
 * Flujo: D2 (collector Playwright) → D3 (downloader) → D4 (Telegram 2do mensaje)
 *
 * IMPORTANTE: esta función NUNCA hace throw al caller.
 * Desde collect.job.ts se llama con .catch() para no bloquear el ciclo principal.
 */
import { v4 as uuidv4 } from "uuid";
import { createModuleLogger } from "../core/logger";
import { nowISO, formatDuration } from "../core/time";
import { collectComprasMxDetail } from "../collectors/comprasmx-detail/index";
import { downloadDocuments } from "../services/document-downloader";
import { sendTelegramMessage } from "../alerts/telegram.alerts";
import { formatEnrichedAlert } from "../alerts/telegram.alerts";

const log = createModuleLogger("enrich-procurement-job");

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface EnrichmentInput {
  procurementId: string;
  procedureNumber: string | null;
  expedienteId: string | null;
  sourceUrl: string | null;
  title: string | null;
  dependency: string | null;
  scope: "MORELOS_ONLY" | "NATIONAL_CAPUFE_DESIERTA";
  radarKey: string;
}

export interface EnrichmentResult {
  jobId: string;
  procurementId: string;
  status: "success" | "partial_success" | "failed" | "skipped_no_documents";
  documentsFound: number;
  documentsDownloaded: number;
  errors: string[];
  enrichedAt: string;
}

// ── Función principal ──────────────────────────────────────────────────────────

export async function enrichProcurement(
  input: EnrichmentInput,
): Promise<EnrichmentResult> {
  const jobId = uuidv4();
  const startedAt = Date.now();
  const errors: string[] = [];

  log.info(
    {
      jobId,
      procurementId: input.procurementId,
      procedureNumber: input.procedureNumber,
      scope: input.scope,
      radarKey: input.radarKey,
      sourceUrl: input.sourceUrl,
      dependency: input.dependency,
      title: input.title,
    },
    "🔍 enrichProcurement iniciado",
  );

  const base: EnrichmentResult = {
    jobId,
    procurementId: input.procurementId,
    status: "skipped_no_documents",
    documentsFound: 0,
    documentsDownloaded: 0,
    errors,
    enrichedAt: nowISO(),
  };

  // 1. Validar sourceUrl
  if (!input.sourceUrl) {
    log.info({ jobId }, "⏩ skipped — sourceUrl nulo");
    return base;
  }

  try {
    // 2. Llamar al detail collector (D2)
    log.info({ jobId, url: input.sourceUrl }, "📡 Llamando collectComprasMxDetail...");
    const collectResult = await collectComprasMxDetail({
      sourceUrl: input.sourceUrl,
      procedureNumber: input.procedureNumber,
      expedienteId: input.expedienteId,
      scope: input.scope,
    });

    const documents = collectResult.documents;
    errors.push(...collectResult.errors);

    log.info(
      {
        jobId,
        documentsFound: documents.length,
        collectorStatus: collectResult.collectorStatus,
      },
      "📄 collectComprasMxDetail completado",
    );

    // 3. Si no hay documentos → skipped
    if (documents.length === 0) {
      const durationMs = Date.now() - startedAt;
      log.info(
        { jobId, durationMs: formatDuration(durationMs) },
        "⏩ skipped — sin documentos",
      );
      return { ...base, status: "skipped_no_documents", errors };
    }

    // 4. Descargar documentos (D3)
    const downloadableDocuments = documents.filter((d) => d.isDownloadable);
    log.info(
      { jobId, total: documents.length, downloadable: downloadableDocuments.length },
      "⬇️ Iniciando descargas...",
    );

    const downloadResults = await downloadDocuments(downloadableDocuments);

    const downloaded = downloadResults.filter(
      (r) => r.downloadStatus === "ok" || r.downloadStatus === "skipped_duplicate",
    );

    downloadResults
      .filter((r) => r.downloadStatus === "failed" || r.downloadStatus === "too_large")
      .forEach((r) => {
        if (r.errorMessage) errors.push(r.errorMessage);
      });

    // 5. Determinar status
    let status: EnrichmentResult["status"];
    if (downloaded.length === downloadableDocuments.length && errors.length === 0) {
      status = "success";
    } else if (downloaded.length > 0) {
      status = "partial_success";
    } else {
      status = "failed";
    }

    const durationMs = Date.now() - startedAt;
    log.info(
      {
        jobId,
        status,
        documentsFound: documents.length,
        documentsDownloaded: downloaded.length,
        durationMs: formatDuration(durationMs),
        errors: errors.length,
      },
      "✅ enrichProcurement completado",
    );

    // 6. Enviar segundo mensaje Telegram (D4) — fire-and-forget
    const enrichedMessage = formatEnrichedAlert({
      procedureNumber: input.procedureNumber ?? "N/D",
      expedienteId: input.expedienteId,
      title: input.title,
      dependency: input.dependency,
      scope: input.scope,
      documentsFound: documents,
      documentsDownloaded: downloadResults,
      errors,
    });

    sendTelegramMessage(enrichedMessage, "HTML").catch((telegramErr) => {
      log.warn({ err: telegramErr, jobId }, "⚠️ No se pudo enviar mensaje enriquecido a Telegram");
    });

    return {
      ...base,
      status,
      documentsFound: documents.length,
      documentsDownloaded: downloaded.length,
      errors,
      enrichedAt: nowISO(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, jobId }, "💥 enrichProcurement error crítico");
    errors.push(msg);
    return { ...base, status: "failed", errors, enrichedAt: nowISO() };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && npm test -- --testPathPattern="enrich-procurement"
```

Expected: 6 tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd apps/worker && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
cd apps/worker && git add src/jobs/enrich-procurement.job.ts src/jobs/__tests__/enrich-procurement.test.ts && git commit -m "feat(D1): enrich-procurement.job — orquestador OSINT no bloqueante (D2→D3→D4)"
```

---

## Task D4: formatEnrichedAlert en src/alerts/telegram.alerts.ts

**Files:**
- Modify: `src/alerts/telegram.alerts.ts` (agregar al final del archivo)
- Test: `src/alerts/__tests__/telegram.enriched.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/alerts/__tests__/telegram.enriched.test.ts`:

```typescript
import { formatEnrichedAlert } from "../telegram.alerts";
import type { EnrichedAlertData } from "../telegram.alerts";
import type { DocumentLink } from "../../collectors/comprasmx-detail/index";
import type { DownloadResult } from "../../services/document-downloader";

function makeDocLink(title: string, status: "ok" | "failed" = "ok"): { doc: DocumentLink; dl: DownloadResult } {
  const doc: DocumentLink = {
    documentTitle: title,
    fileName: `${title.toLowerCase().replace(/\s/g, "_")}.pdf`,
    fileUrl: `https://example.com/${title}.pdf`,
    fileType: "pdf",
    source: "ComprasMX",
    discoveredAt: "2026-05-07T00:00:00Z",
    documentHint: "convocatoria",
    isDownloadable: true,
  };
  const dl: DownloadResult = {
    fileUrl: doc.fileUrl,
    fileName: doc.fileName!,
    fileType: "pdf",
    sha256Hash: status === "ok" ? "abc123" : null,
    downloadStatus: status,
    sizeBytes: status === "ok" ? 1024 : null,
    localPath: status === "ok" ? "/tmp/radar-docs/abc123.pdf" : null,
    errorMessage: status === "ok" ? null : "Timeout",
    downloadedAt: "2026-05-07T00:00:00Z",
  };
  return { doc, dl };
}

const baseData: EnrichedAlertData = {
  procedureNumber: "CAPUFE-2026-LO-001",
  expedienteId: "EXP-2026-001",
  title: "Mantenimiento correctivo de casetas de peaje",
  dependency: "CAPUFE",
  scope: "NATIONAL_CAPUFE_DESIERTA",
  documentsFound: [],
  documentsDownloaded: [],
  errors: [],
};

describe("formatEnrichedAlert", () => {
  it("sin documentos → mensaje corto con 'sin documentos públicos'", () => {
    const msg = formatEnrichedAlert({ ...baseData });

    expect(msg).toContain("CAPUFE-2026-LO-001");
    expect(msg).toContain("sin documentos públicos");
    expect(msg).not.toContain("Documentos encontrados");
  });

  it("con documentos → incluye sección documentos y conteo", () => {
    const { doc, dl } = makeDocLink("Bases del procedimiento");
    const msg = formatEnrichedAlert({
      ...baseData,
      documentsFound: [doc],
      documentsDownloaded: [dl],
    });

    expect(msg).toContain("Documentos encontrados (1)");
    expect(msg).toContain("Bases del procedimiento");
    expect(msg).toContain("✅");
  });

  it("documento con descarga fallida → ⚠️ marker", () => {
    const { doc, dl } = makeDocLink("Anexo Técnico", "failed");
    const msg = formatEnrichedAlert({
      ...baseData,
      documentsFound: [doc],
      documentsDownloaded: [dl],
    });

    expect(msg).toContain("⚠️");
  });

  it("con errores → sección errores presente", () => {
    const msg = formatEnrichedAlert({
      ...baseData,
      errors: ["Timeout en la conexión"],
    });

    expect(msg).toContain("Errores controlados");
    expect(msg).toContain("Timeout en la conexión");
  });

  it("sin errores → sin sección de errores", () => {
    const { doc, dl } = makeDocLink("Bases");
    const msg = formatEnrichedAlert({
      ...baseData,
      documentsFound: [doc],
      documentsDownloaded: [dl],
      errors: [],
    });

    expect(msg).not.toContain("Errores controlados");
  });

  it("mensaje siempre contiene disclamer legal", () => {
    const msg = formatEnrichedAlert(baseData);
    expect(msg).toContain("información pública");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/worker && npm test -- --testPathPattern="telegram.enriched"
```

Expected: FAIL with "formatEnrichedAlert is not a function" or import error.

- [ ] **Step 3: Add EnrichedAlertData and formatEnrichedAlert to src/alerts/telegram.alerts.ts**

Agregar al final del archivo (después de `sendEnhancedDailySummary`):

```typescript
// ─── Alerta enriquecida (Fase D) ──────────────────────────────────────────────

import type { DocumentLink } from "../collectors/comprasmx-detail/index";
import type { DownloadResult } from "../services/document-downloader";

export interface EnrichedAlertData {
  procedureNumber: string;
  expedienteId: string | null;
  title: string | null;
  dependency: string | null;
  scope: string;
  documentsFound: DocumentLink[];
  documentsDownloaded: DownloadResult[];
  errors: string[];
}

/**
 * Formatea el segundo mensaje Telegram con el resultado del enriquecimiento OSINT.
 * Si supera 4096 chars, trunca con "... (mensaje truncado)".
 * Si no hay documentos, envía un mensaje corto.
 */
export function formatEnrichedAlert(data: EnrichedAlertData): string {
  const procedureNumber = escapeHtml(data.procedureNumber);
  const expedienteId = escapeHtml(data.expedienteId ?? "N/D");
  const title = escapeHtml(data.title ?? "N/D");
  const dependency = escapeHtml(data.dependency ?? "N/D");
  const scope = escapeHtml(data.scope);

  // Mensaje corto si no hay documentos
  if (data.documentsFound.length === 0) {
    const lines = [
      "📁 <b>EXPEDIENTE ENRIQUECIDO</b>",
      "",
      `🔢 <b>Licitación:</b> ${procedureNumber}`,
      `🏛 <b>Dependencia:</b> ${dependency}`,
      `🌎 <b>Alcance:</b> ${scope}`,
      "",
      "📄 <b>Estado:</b> Documentos aún no disponibles públicamente. sin documentos públicos",
      "",
      "⚖️ <i>Análisis basado únicamente en información pública.</i>",
    ];
    return truncateForTelegram(lines.join("\n"));
  }

  // Construir líneas de documentos
  const downloadedUrls = new Set(
    data.documentsDownloaded
      .filter((r) => r.downloadStatus === "ok" || r.downloadStatus === "skipped_duplicate")
      .map((r) => r.fileUrl),
  );

  const docLines = data.documentsFound.map((doc) => {
    const icon = downloadedUrls.has(doc.fileUrl) ? "✅" : "⚠️";
    return `  ${icon} ${escapeHtml(doc.documentTitle)}`;
  });

  const downloadedCount = data.documentsDownloaded.filter(
    (r) => r.downloadStatus === "ok" || r.downloadStatus === "skipped_duplicate",
  ).length;

  const analysisStatus =
    downloadedCount > 0
      ? "Expediente revisado parcialmente."
      : "Ningún documento pudo ser descargado.";

  const lines: string[] = [
    "📁 <b>EXPEDIENTE ENRIQUECIDO</b>",
    "",
    `🔢 <b>Licitación:</b> ${procedureNumber}`,
    `📋 <b>Expediente:</b> ${expedienteId}`,
    `📌 <b>Objeto:</b> ${title}`,
    `🏛 <b>Dependencia:</b> ${dependency}`,
    `🌎 <b>Alcance:</b> ${scope}`,
    "",
    `📄 <b>Documentos encontrados (${data.documentsFound.length}):</b>`,
    ...docLines,
    "",
    `📊 <b>Estado del análisis:</b> ${escapeHtml(analysisStatus)}`,
  ];

  if (data.errors.length > 0) {
    lines.push("");
    lines.push("⚠️ <b>Errores controlados:</b>");
    data.errors.slice(0, 3).forEach((e) => lines.push(`  • ${escapeHtml(e)}`));
  }

  lines.push("");
  lines.push("⚖️ <i>Análisis basado únicamente en información pública.</i>");

  return truncateForTelegram(lines.filter((l) => l !== undefined).join("\n"));
}
```

**Nota sobre imports:** Los `import type` deben ir al top del archivo. Como TypeScript no permite imports en medio del archivo para `type`, en la práctica, agrega los imports al top del archivo de `telegram.alerts.ts` junto con los demás imports existentes:

```typescript
// Agregar al bloque de imports existente al inicio del archivo:
import type { DocumentLink } from "../collectors/comprasmx-detail/index";
import type { DownloadResult } from "../services/document-downloader";
```

Y el `export interface EnrichedAlertData` y `export function formatEnrichedAlert` van al final del archivo (sin el inline `import type` duplicado).

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && npm test -- --testPathPattern="telegram.enriched"
```

Expected: 6 tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd apps/worker && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
cd apps/worker && git add src/alerts/telegram.alerts.ts src/alerts/__tests__/telegram.enriched.test.ts && git commit -m "feat(D4): formatEnrichedAlert — segundo mensaje Telegram con documentos y estado OSINT"
```

---

## Task D-Integration: Modificar src/jobs/collect.job.ts

**Files:**
- Modify: `src/jobs/collect.job.ts`

**Contexto:** En collect.job.ts, después de la llamada `await sendMatchAlert(enriched)` (línea ~564), agregar el lanzamiento no bloqueante de `enrichProcurement`. También se importa `filterProcurementScope` del C3 para derivar el scope.

- [ ] **Step 1: Agregar imports al top de collect.job.ts**

Localizar el bloque de imports cerca del inicio del archivo. Agregar después de los imports existentes de `classifyAlert` y `getConfig`:

```typescript
import { enrichProcurement } from "./enrich-procurement.job";
import { filterProcurementScope } from "../services/procurement-scope-filter";
```

- [ ] **Step 2: Agregar llamada no bloqueante después de sendMatchAlert**

Localizar el bloque (aproximadamente líneas 561-572 en collect.job.ts):

```typescript
const msgId = await sendMatchAlert(enriched);

if (msgId) {
  alertsSentThisCycle++;
  cycleMetrics.sent++;
  await markAlertSent(alertId, msgId);
} else {
  await markAlertFailed(alertId);
}
```

Agregar DESPUÉS del bloque `if (msgId) { ... }`:

```typescript
// Lanzar enrichment de forma no bloqueante (Fase D)
const scopeResult = filterProcurementScope({
  state: item.state,
  municipality: item.municipality,
  dependency: item.dependencyName,
  status: item.status,
  canonical_text: item.canonicalText,
});
if (scopeResult.allowed) {
  enrichProcurement({
    procurementId: upsertResult.procurementId,
    procedureNumber: item.procedureNumber ?? item.licitationNumber,
    expedienteId: item.expedienteId,
    sourceUrl: item.sourceUrl,
    title: item.title,
    dependency: item.dependencyName,
    scope: scopeResult.scope,
    radarKey: match.radarKey,
  }).catch((err: unknown) =>
    log.warn({ err }, "Enrichment falló silenciosamente"),
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/worker && npm run typecheck
```

Expected: sin errores (enrichProcurement acepta `scope: "MORELOS_ONLY" | "NATIONAL_CAPUFE_DESIERTA"` y scopeResult.scope cuando allowed=true siempre es uno de esos dos).

- [ ] **Step 4: Ejecutar todos los tests**

```bash
cd apps/worker && npm test
```

Expected: 130+ tests pasando, ninguno roto.

- [ ] **Step 5: Commit**

```bash
cd apps/worker && git add src/jobs/collect.job.ts && git commit -m "feat(D-integration): lanzar enrichProcurement no bloqueante tras sendMatchAlert en collect.job"
```

- [ ] **Step 6: Push a origin main**

```bash
cd apps/worker && git push origin main
```

---

## Resumen de Archivos

| Archivo | Acción | Tests nuevos |
|---------|--------|-------------|
| `src/collectors/comprasmx-detail/index.ts` | Crear | 12 |
| `src/services/document-downloader.ts` | Crear | 6 |
| `src/jobs/enrich-procurement.job.ts` | Crear | 6 |
| `src/alerts/telegram.alerts.ts` | Modificar (agregar) | 6 |
| `src/jobs/collect.job.ts` | Modificar (integration) | 0 |

**Total tests nuevos estimados:** 30 (130 existentes + 30 = 160+ total)

---

## Self-Review

**Spec coverage:**
- ✅ D1: `enrichProcurement(input)` exportado con tipos completos
- ✅ D1: Estados pending→running→success|partial_success|failed|skipped_no_documents (solo en logs)
- ✅ D1: sourceUrl null → skipped_no_documents inmediato
- ✅ D1: Nunca throw al caller
- ✅ D1: Log de inicio con todos los datos
- ✅ D2: `collectComprasMxDetail` con BrowserManager.withContext
- ✅ D2: Clasificación `documentHint` por nombre y título
- ✅ D2: `extractFileType` por extensión URL
- ✅ D2: Rate limit 3s
- ✅ D2: 15s timeout → no_documents
- ✅ D2: Playwright falla → error, no throw
- ✅ D3: `downloadDocument` + `downloadDocuments` exportados
- ✅ D3: Max 20MB
- ✅ D3: `/tmp/radar-docs/{sha256}.{ext}`
- ✅ D3: skipped_duplicate
- ✅ D3: Rate limit 2s (omitido en test environment)
- ✅ D3: Solo pdf/docx/xlsx/zip
- ✅ D3: Same User-Agent que BrowserManager
- ✅ D4: `formatEnrichedAlert` con el formato especificado
- ✅ D4: Mensaje corto si 0 documentos
- ✅ D4: Truncar a 4096 chars
- ✅ D4: Escapar HTML
- ✅ Integration: `.catch()` en enrichProcurement
- ✅ Integration: `filterProcurementScope` para derivar scope
- ✅ Integration: Solo lanzar si scope.allowed = true

**Placeholder scan:** Ningún TBD, TODO o sección incompleta.

**Type consistency:**
- `DocumentLink` definido en D2, importado en D3 (solo type), D1, D4
- `DownloadResult` definido en D3, importado en D1, D4
- `EnrichmentInput`/`EnrichmentResult` definidos en D1
- `EnrichedAlertData` definido en D4 (telegram.alerts.ts), referenciado en D1
