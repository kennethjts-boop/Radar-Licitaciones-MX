# Hardening Pre-Producción Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver los 4 problemas críticos de producción: MAX_ALERTS_PER_CYCLE desincronizado, PDF sin timeout, sin tests unitarios, y falta de alerta Telegram en fallo catastrófico del collector.

**Architecture:** Fixes puntuales en archivos existentes sin agregar dependencias. Tests cubren lógica pura (sin BD, sin red) usando jest + ts-jest ya instalados.

**Tech Stack:** TypeScript, Jest 29, ts-jest, Node.js 20

---

## Archivos modificados / creados

| Acción | Archivo |
|--------|---------|
| Modify | `apps/worker/src/jobs/collect.job.ts:54` |
| Modify | `apps/worker/src/utils/pdf.util.ts` |
| Modify | `apps/worker/src/jobs/collect.job.ts` (error handler) |
| Create | `apps/worker/jest.config.js` |
| Create | `apps/worker/src/core/__tests__/text.test.ts` |
| Create | `apps/worker/src/matchers/__tests__/matcher.test.ts` |
| Create | `apps/worker/src/utils/__tests__/pdf.util.test.ts` |

---

### Task 1: Restaurar MAX_ALERTS_PER_CYCLE a 10

**Files:**
- Modify: `apps/worker/src/jobs/collect.job.ts:54`

- [ ] **Step 1: Cambiar la constante**

En `collect.job.ts` línea 54, cambiar:
```typescript
const MAX_ALERTS_PER_CYCLE = 9999;
```
a:
```typescript
const MAX_ALERTS_PER_CYCLE = 10;
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/worker && npm run typecheck
```
Expected: 0 errores

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/jobs/collect.job.ts
git commit -m "fix: restaurar MAX_ALERTS_PER_CYCLE a 10 según CLAUDE.md"
```

---

### Task 2: Agregar timeout a extractTextFromPdf

**Files:**
- Modify: `apps/worker/src/utils/pdf.util.ts`

- [ ] **Step 1: Agregar timeout interno**

En `pdf.util.ts`, reemplazar la llamada a `pdf()` dentro de `extractTextFromPdf` para agregar un timeout de 30 segundos:

```typescript
const PDF_TIMEOUT_MS = 30_000;

export async function extractTextFromPdf(
  tempFilePath: string,
  options: ExtractPdfTextOptions = {},
): Promise<string> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  try {
    const fileBuffer = readFileSync(tempFilePath);

    const parsed = await Promise.race([
      pdf(fileBuffer, { max: maxPages }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`PDF parse timeout after ${PDF_TIMEOUT_MS}ms`)),
          PDF_TIMEOUT_MS,
        ),
      ),
    ]);

    const rawText = (parsed.text ?? "").trim();
    if (!rawText) {
      return "";
    }

    if (rawText.length > maxChars) {
      log.info(
        { tempFilePath, maxPages, maxChars, extractedChars: rawText.length },
        "Texto de PDF truncado por guardrail de caracteres",
      );
      return rawText.slice(0, maxChars);
    }

    return rawText;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message, tempFilePath }, "Fallo extrayendo texto de PDF");
    throw new Error(`No se pudo extraer texto del PDF: ${message}`);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/worker && npm run typecheck
```
Expected: 0 errores

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/utils/pdf.util.ts
git commit -m "fix: agregar timeout de 30s a extractTextFromPdf para evitar hang en PDFs corruptos"
```

---

### Task 3: Notificar a Telegram cuando el collector falla catastróficamente

**Files:**
- Modify: `apps/worker/src/jobs/collect.job.ts` (bloque catch principal)

- [ ] **Step 1: Agregar alerta en el catch del ciclo principal**

En `runCollectJob()`, el bloque `catch (err)` alrededor de línea 700:

```typescript
} catch (err) {
  errorMessage = err instanceof Error ? err.message : String(err);
  log.error({ err }, "Error en ciclo de colección");
  // Notificar a Telegram cuando hay falla crítica del collector
  await sendTelegramMessage(
    `🚨 <b>ERROR CRÍTICO EN COLLECTOR</b>\n\n` +
    `El ciclo de colección falló con un error no recuperable:\n` +
    `<code>${errorMessage?.slice(0, 200) ?? "Error desconocido"}</code>\n\n` +
    `Revisar logs de Railway para más detalles.`,
    "HTML",
  ).catch(() => {});
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/worker && npm run typecheck
```
Expected: 0 errores

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/jobs/collect.job.ts
git commit -m "feat: enviar alerta Telegram cuando el collector falla catastróficamente"
```

---

### Task 4: Configurar Jest

**Files:**
- Create: `apps/worker/jest.config.js`

- [ ] **Step 1: Crear jest.config.js**

```javascript
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@matchers/(.*)$': '<rootDir>/src/matchers/$1',
    '^@normalizers/(.*)$': '<rootDir>/src/normalizers/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@alerts/(.*)$': '<rootDir>/src/alerts/$1',
    '^@storage/(.*)$': '<rootDir>/src/storage/$1',
    '^@radars/(.*)$': '<rootDir>/src/radars/$1',
    '^@enrichers/(.*)$': '<rootDir>/src/enrichers/$1',
    '^@jobs/(.*)$': '<rootDir>/src/jobs/$1',
    '^@collectors/(.*)$': '<rootDir>/src/collectors/$1',
    '^@commands/(.*)$': '<rootDir>/src/commands/$1',
    '^@agent/(.*)$': '<rootDir>/src/agent/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { strict: true } }],
  },
  collectCoverageFrom: [
    'src/core/text.ts',
    'src/matchers/matcher.ts',
    'src/utils/pdf.util.ts',
  ],
  coverageThreshold: {
    global: { lines: 80 },
  },
};
```

- [ ] **Step 2: Verificar que jest corre (sin tests aún)**

```bash
cd apps/worker && npx jest --listTests
```
Expected: lista vacía (sin error de config)

- [ ] **Step 3: Commit**

```bash
git add apps/worker/jest.config.js
git commit -m "chore: agregar configuración de Jest con ts-jest y moduleNameMapper"
```

---

### Task 5: Tests unitarios — core/text.ts

**Files:**
- Create: `apps/worker/src/core/__tests__/text.test.ts`

- [ ] **Step 1: Escribir tests**

```typescript
import {
  normalizeText,
  sanitizeForKeywordRegex,
  tokenize,
  buildCanonicalText,
  textContainsTerm,
  findMatchingTerms,
  findExcludedTerms,
  truncateForTelegram,
  formatCurrency,
} from "../text";

describe("normalizeText", () => {
  it("convierte a minúsculas", () => {
    expect(normalizeText("CAPUFE")).toBe("capufe");
  });

  it("elimina diacríticos", () => {
    expect(normalizeText("licitación")).toBe("licitacion");
  });

  it("reemplaza puntuación con espacios", () => {
    expect(normalizeText("a,b;c")).toBe("a b c");
  });

  it("colapsa espacios múltiples", () => {
    expect(normalizeText("  hola   mundo  ")).toBe("hola mundo");
  });

  it("maneja string vacío", () => {
    expect(normalizeText("")).toBe("");
  });
});

describe("textContainsTerm", () => {
  it("encuentra término normalizado en texto", () => {
    expect(textContainsTerm("Licitación CAPUFE 2024", "capufe")).toBe(true);
  });

  it("encuentra término con tildes en texto sin tildes", () => {
    expect(textContainsTerm("licitacion publica", "licitación")).toBe(true);
  });

  it("retorna false cuando el término no está", () => {
    expect(textContainsTerm("compras imss morelos", "capufe")).toBe(false);
  });
});

describe("findMatchingTerms", () => {
  it("retorna solo los términos que aparecen en el texto", () => {
    const result = findMatchingTerms("contrato de peaje capufe 2024", [
      "peaje",
      "imss",
      "capufe",
    ]);
    expect(result).toEqual(["peaje", "capufe"]);
  });

  it("retorna array vacío si no hay matches", () => {
    expect(findMatchingTerms("licitacion issste", ["capufe", "imss"])).toEqual([]);
  });

  it("retorna array vacío si terms list está vacía", () => {
    expect(findMatchingTerms("cualquier texto", [])).toEqual([]);
  });
});

describe("findExcludedTerms", () => {
  it("detecta términos de exclusión presentes", () => {
    expect(
      findExcludedTerms("convocatoria cancelada urgente", ["cancelada", "suspendida"])
    ).toEqual(["cancelada"]);
  });

  it("retorna vacío si no hay exclusiones en el texto", () => {
    expect(
      findExcludedTerms("licitación vigente peaje", ["cancelada", "desierta"])
    ).toEqual([]);
  });
});

describe("buildCanonicalText", () => {
  it("combina campos con separador |", () => {
    const result = buildCanonicalText({
      title: "Peaje",
      dependencyName: "CAPUFE",
      buyingUnit: "Administración Central",
    });
    expect(result).toBe("Peaje | CAPUFE | Administración Central");
  });

  it("omite campos nulos", () => {
    const result = buildCanonicalText({
      title: "Peaje",
      dependencyName: null,
      buyingUnit: null,
    });
    expect(result).toBe("Peaje");
  });
});

describe("truncateForTelegram", () => {
  it("no trunca textos cortos", () => {
    const text = "Hola mundo";
    expect(truncateForTelegram(text)).toBe(text);
  });

  it("trunca textos que exceden 4000 chars y agrega ...", () => {
    const longText = "a".repeat(5000);
    const result = truncateForTelegram(longText);
    expect(result.length).toBe(4000);
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("formatCurrency", () => {
  it("formatea moneda MXN correctamente", () => {
    const result = formatCurrency(1000000, "MXN");
    expect(result).toContain("1");
    expect(result).toContain("000");
  });

  it("retorna 'No especificado' para amount null", () => {
    expect(formatCurrency(null, "MXN")).toBe("No especificado");
  });

  it("retorna 'No especificado' para amount 0", () => {
    expect(formatCurrency(0, "MXN")).toBe("No especificado");
  });

  it("usa MXN como default cuando currency es null", () => {
    const result = formatCurrency(500, null);
    expect(result).toBeTruthy();
    expect(result).not.toBe("No especificado");
  });
});

describe("tokenize", () => {
  it("extrae tokens únicos de mínimo 3 chars", () => {
    const result = tokenize("El contrato de CAPUFE es vigente");
    expect(result).toContain("contrato");
    expect(result).toContain("capufe");
    expect(result).toContain("vigente");
    expect(result).not.toContain("de");
    expect(result).not.toContain("el");
  });

  it("elimina duplicados", () => {
    const result = tokenize("capufe capufe peaje peaje");
    expect(result.filter((t) => t === "capufe").length).toBe(1);
  });
});
```

- [ ] **Step 2: Correr tests**

```bash
cd apps/worker && npx jest src/core/__tests__/text.test.ts --no-coverage
```
Expected: PASS, todos los tests en verde

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/core/__tests__/text.test.ts
git commit -m "test: agregar tests unitarios para core/text.ts"
```

---

### Task 6: Tests unitarios — matchers/matcher.ts

**Files:**
- Create: `apps/worker/src/matchers/__tests__/matcher.test.ts`

- [ ] **Step 1: Escribir tests**

```typescript
import {
  evaluateProcurementAgainstRadar,
  evaluateAllRadars,
} from "../matcher";
import type { NormalizedProcurement, RadarConfig } from "../../types/procurement";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProcurement(overrides: Partial<NormalizedProcurement> = {}): NormalizedProcurement {
  return {
    externalId: "TEST-001",
    expedienteId: "EXP-001",
    licitationNumber: "LIC-001",
    procedureNumber: "PROC-001",
    title: "Servicio de mantenimiento de casetas de peaje CAPUFE",
    description: "Contrato de mantenimiento correctivo de equipos en casetas",
    canonicalText: "servicio mantenimiento casetas peaje capufe contrato equipos",
    dependencyName: "CAPUFE",
    buyingUnit: "Administración Central",
    status: "Vigente",
    state: "Ciudad de México",
    municipality: null,
    amount: 1000000,
    currency: "MXN",
    publicationDate: "2026-01-01",
    openingDate: null,
    closingDate: null,
    sourceUrl: "https://example.com/exp/001",
    sourceKey: "comprasmx",
    attachments: [],
    canonicalFingerprint: "abc123",
    lightweightFingerprint: "def456",
    rawJson: {},
    ...overrides,
  };
}

function makeRadar(overrides: Partial<RadarConfig> = {}): RadarConfig {
  return {
    key: "test-radar",
    name: "Test Radar",
    isActive: true,
    includeTerms: ["capufe", "peaje"],
    excludeTerms: [],
    rules: [],
    minScore: 0.3,
    ...overrides,
  };
}

// ── evaluateProcurementAgainstRadar ───────────────────────────────────────────

describe("evaluateProcurementAgainstRadar", () => {
  it("retorna match cuando términos están presentes", () => {
    const proc = makeProcurement();
    const radar = makeRadar();
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result).not.toBeNull();
    expect(result!.matchScore).toBeGreaterThan(0);
    expect(result!.matchedTerms).toContain("capufe");
    expect(result!.matchedTerms).toContain("peaje");
  });

  it("retorna null cuando no hay términos incluidos en el texto", () => {
    const proc = makeProcurement({ canonicalText: "contrato de limpieza hospitalaria" });
    const radar = makeRadar({ includeTerms: ["capufe", "peaje"] });
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result).toBeNull();
  });

  it("retorna null si radar está inactivo (evaluateAllRadars lo filtra)", () => {
    const proc = makeProcurement();
    const radar = makeRadar({ isActive: false });
    // evaluateProcurementAgainstRadar en sí no chequea isActive — lo hace evaluateAllRadars
    // Verificamos que evaluateAllRadars lo filtra
    const results = evaluateAllRadars(proc, [radar], true);
    expect(results).toHaveLength(0);
  });

  it("penaliza score cuando hay términos excluidos", () => {
    const proc = makeProcurement({
      canonicalText: "capufe peaje cancelado suspendido",
    });
    const radarSinExclusiones = makeRadar({ excludeTerms: [] });
    const radarConExclusiones = makeRadar({ excludeTerms: ["cancelado", "suspendido"] });

    const resultSin = evaluateProcurementAgainstRadar(proc, radarSinExclusiones, true);
    const resultCon = evaluateProcurementAgainstRadar(proc, radarConExclusiones, true);

    expect(resultSin).not.toBeNull();
    expect(resultCon).not.toBeNull();
    expect(resultCon!.matchScore).toBeLessThan(resultSin!.matchScore);
  });

  it("retorna null si score penalizado no supera minScore", () => {
    const proc = makeProcurement({
      canonicalText: "capufe peaje cancelado desierto suspendido",
    });
    const radar = makeRadar({
      includeTerms: ["capufe"],
      excludeTerms: ["cancelado", "desierto", "suspendido"],
      minScore: 0.9, // umbral muy alto
    });
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result).toBeNull();
  });

  it("clasifica HIGH cuando score >= 0.7", () => {
    const proc = makeProcurement({
      canonicalText: "capufe peaje casetas mantenimiento contrato equipos sistema boletaje",
    });
    const radar = makeRadar({
      includeTerms: ["capufe", "peaje"],
      minScore: 0.1,
    });
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result).not.toBeNull();
    // Con muchos términos match el score debe ser alto
    if (result!.matchScore >= 0.7) {
      expect(result!.matchLevel).toBe("high");
    }
  });

  it("evalúa regla 'contains' correctamente", () => {
    const proc = makeProcurement({ dependencyName: "CAPUFE" });
    const radar = makeRadar({
      includeTerms: ["peaje"],
      rules: [
        {
          fieldName: "dependency_name",
          operator: "contains",
          value: "capufe",
          isRequired: true,
          weight: 1,
        },
      ],
    });
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result).not.toBeNull();
  });

  it("retorna null si regla required no se cumple", () => {
    const proc = makeProcurement({ dependencyName: "IMSS" });
    const radar = makeRadar({
      includeTerms: ["peaje"],
      rules: [
        {
          fieldName: "dependency_name",
          operator: "contains",
          value: "capufe",
          isRequired: true,
          weight: 1,
        },
      ],
    });
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result).toBeNull();
  });

  it("evalúa regla 'any_of' correctamente", () => {
    const proc = makeProcurement({ state: "Morelos" });
    const radar = makeRadar({
      includeTerms: ["mantenimiento"],
      rules: [
        {
          fieldName: "state",
          operator: "any_of",
          value: ["Morelos", "CDMX", "Jalisco"],
          isRequired: true,
          weight: 1,
        },
      ],
    });
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result).not.toBeNull();
  });

  it("marca isNew correctamente", () => {
    const proc = makeProcurement();
    const radar = makeRadar();
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result!.isNew).toBe(true);
  });

  it("detecta cambio de status correctamente", () => {
    const proc = makeProcurement({ status: "Adjudicado" });
    const radar = makeRadar();
    const result = evaluateProcurementAgainstRadar(proc, radar, false, "Vigente");
    expect(result!.isStatusChange).toBe(true);
    expect(result!.previousStatus).toBe("Vigente");
  });
});

// ── evaluateAllRadars ─────────────────────────────────────────────────────────

describe("evaluateAllRadars", () => {
  it("evalúa múltiples radares y retorna todos los matches", () => {
    const proc = makeProcurement({
      canonicalText: "capufe peaje mantenimiento imss morelos contrato",
    });
    const radars = [
      makeRadar({ key: "capufe", includeTerms: ["capufe", "peaje"] }),
      makeRadar({ key: "imss-morelos", includeTerms: ["imss", "morelos"] }),
    ];
    const results = evaluateAllRadars(proc, radars, true);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.radarKey)).toContain("capufe");
    expect(results.map((r) => r.radarKey)).toContain("imss-morelos");
  });

  it("omite radares inactivos", () => {
    const proc = makeProcurement();
    const radars = [
      makeRadar({ key: "activo", isActive: true }),
      makeRadar({ key: "inactivo", isActive: false }),
    ];
    const results = evaluateAllRadars(proc, radars, true);
    expect(results.every((r) => r.radarKey === "activo")).toBe(true);
  });

  it("retorna array vacío si no hay matches", () => {
    const proc = makeProcurement({ canonicalText: "limpieza hospitalaria cdmx" });
    const radars = [makeRadar({ includeTerms: ["capufe", "peaje"] })];
    const results = evaluateAllRadars(proc, radars, true);
    expect(results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Correr tests**

```bash
cd apps/worker && npx jest src/matchers/__tests__/matcher.test.ts --no-coverage
```
Expected: PASS (todos los tests deben pasar dado que el matcher es lógica pura)

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/matchers/__tests__/matcher.test.ts
git commit -m "test: agregar tests unitarios para matchers/matcher.ts"
```

---

### Task 7: Tests unitarios — utils/pdf.util.ts

**Files:**
- Create: `apps/worker/src/utils/__tests__/pdf.util.test.ts`

- [ ] **Step 1: Escribir tests**

```typescript
import { chunkText } from "../pdf.util";

// extractTextFromPdf depende del sistema de archivos y pdf-parse — se prueba via integración.
// chunkText es lógica pura y se puede probar sin mocks.

describe("chunkText", () => {
  it("retorna array vacío para texto vacío", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("retorna texto corto como un solo chunk", () => {
    const text = "Este es un texto corto para prueba.";
    const result = chunkText(text, 800);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  it("divide texto largo en múltiples chunks", () => {
    // Generar texto que supere maxTokens (800 tokens ≈ 3200 chars)
    const longText = Array.from({ length: 200 }, (_, i) => `Párrafo ${i}: Este es un texto de prueba con suficiente contenido para generar múltiples chunks en el sistema.`).join("\n\n");
    const result = chunkText(longText, 100);
    expect(result.length).toBeGreaterThan(1);
  });

  it("todos los chunks tienen contenido no vacío", () => {
    const text = "Primero.\n\nSegundo.\n\nTercero.\n\nCuarto.\n\nQuinto.";
    const result = chunkText(text, 5); // maxTokens muy pequeño para forzar splits
    expect(result.every((c) => c.trim().length > 0)).toBe(true);
  });

  it("respeta maxTokens aproximadamente", () => {
    const text = "palabra ".repeat(1000); // ~1000 tokens
    const maxTokens = 100;
    const result = chunkText(text, maxTokens, 0);
    // Cada chunk no debería exceder maxTokens * 4 chars significativamente
    result.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(maxTokens * 4 * 1.5); // 50% headroom
    });
  });
});
```

- [ ] **Step 2: Correr tests**

```bash
cd apps/worker && npx jest src/utils/__tests__/pdf.util.test.ts --no-coverage
```
Expected: PASS

- [ ] **Step 3: Correr todos los tests juntos**

```bash
cd apps/worker && npm test -- --no-coverage
```
Expected: PASS en todos los archivos de test

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/utils/__tests__/pdf.util.test.ts
git commit -m "test: agregar tests unitarios para utils/pdf.util.ts (chunkText)"
```

---

### Task 8: Typecheck final + build + push

- [ ] **Step 1: Typecheck completo**

```bash
cd apps/worker && npm run typecheck
```
Expected: 0 errores

- [ ] **Step 2: Build**

```bash
cd apps/worker && npm run build
```
Expected: compilación exitosa sin errores

- [ ] **Step 3: Todos los tests**

```bash
cd apps/worker && npm test -- --no-coverage
```
Expected: todos los tests en verde

- [ ] **Step 4: Push a main**

```bash
git push origin main
```
