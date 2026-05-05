# Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir los hallazgos críticos, altos y medios del audit de seguridad y calidad de código.

**Architecture:** Todos los cambios son dentro del worker (`apps/worker/src/`). No hay cambios de schema de DB ni de infraestructura. Las correcciones son independientes entre sí salvo la Tarea 2 (async readFile) que depende del import de `fs/promises`.

**Tech Stack:** TypeScript, Node.js 20, Playwright, OpenAI SDK v5, Supabase, node-telegram-bot-api, Pino

---

## File Map

| Archivo | Cambios |
|---|---|
| `apps/worker/src/jobs/collect.job.ts` | M6: MAX_ALERTS, C3: readFileSync→async, H1: await embeddings |
| `apps/worker/src/ai/openai.service.ts` | H5: fix model name |
| `apps/worker/src/core/http-server.ts` | C1: auth en /api/* endpoints |
| `apps/worker/src/alerts/telegram.alerts.ts` | M2: escapeHtml en title y dependencyName |
| `apps/worker/package.json` | H6: eliminar puppeteer y xlsx |

---

## Task 1: Fix MAX_ALERTS_PER_CYCLE (M6 — SPAM RISK)

**Files:**
- Modify: `apps/worker/src/jobs/collect.job.ts:58`

- [ ] **Step 1: Cambiar la constante**

```typescript
// apps/worker/src/jobs/collect.job.ts, línea 58
// ANTES:
const MAX_ALERTS_PER_CYCLE = 9999;

// DESPUÉS:
const MAX_ALERTS_PER_CYCLE = 10;
```

- [ ] **Step 2: Verificar typecheck**

```bash
cd apps/worker && npm run typecheck
```

Expected: sin errores

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/jobs/collect.job.ts
git commit -m "fix(alerts): restore MAX_ALERTS_PER_CYCLE to 10 to prevent spam"
```

---

## Task 2: Fix event loop blocking readFileSync (C3 — CRITICAL)

**Files:**
- Modify: `apps/worker/src/jobs/collect.job.ts:19,191`

El `readFileSync` en línea 191 bloquea el event loop de Node en el medio de un handler async. Se reemplaza con `readFile` de `fs/promises`.

- [ ] **Step 1: Actualizar el import en la línea 19**

```typescript
// ANTES:
import { existsSync, readFileSync, unlinkSync } from "fs";

// DESPUÉS:
import { existsSync, unlinkSync } from "fs";
import { readFile } from "fs/promises";
```

- [ ] **Step 2: Reemplazar la llamada en línea ~191**

```typescript
// ANTES:
const rawPdfText = readFileSync(file.tempFilePath).toString("latin1");

// DESPUÉS:
const rawPdfText = (await readFile(file.tempFilePath)).toString("latin1");
```

- [ ] **Step 3: Verificar typecheck**

```bash
cd apps/worker && npm run typecheck
```

Expected: sin errores. Si aparece "await en contexto no-async", confirmar que la función contenedora es `async` — lo es (el handler del `for` loop ya es async).

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/jobs/collect.job.ts
git commit -m "fix(collect): replace blocking readFileSync with async readFile"
```

---

## Task 3: Fix model name gpt-4.1-mini (H5)

**Files:**
- Modify: `apps/worker/src/ai/openai.service.ts:7`

El modelo `gpt-4.1-mini` no existe en OpenAI. El README documenta `gpt-4o-mini`. Se cambia el fallback del env var.

- [ ] **Step 1: Corregir el nombre del modelo**

```typescript
// apps/worker/src/ai/openai.service.ts, línea 7
// ANTES:
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

// DESPUÉS:
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
```

- [ ] **Step 2: Verificar typecheck**

```bash
cd apps/worker && npm run typecheck
```

Expected: sin errores

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/ai/openai.service.ts
git commit -m "fix(ai): correct model name from gpt-4.1-mini to gpt-4o-mini"
```

---

## Task 4: Add auth to internal HTTP API endpoints (C1 — CRITICAL)

**Files:**
- Modify: `apps/worker/src/core/http-server.ts`

Los endpoints `/api/topes/federales` y `/api/licitaciones/evaluar-modalidad` están expuestos sin autenticación. Se agrega verificación de un header `X-Internal-Token` contra `process.env.INTERNAL_API_TOKEN`. Si el env var no está definido, los endpoints quedan deshabilitados (404) para evitar que queden abiertos por accidente.

- [ ] **Step 1: Agregar función de verificación de token**

En `http-server.ts`, antes de la función `createHttpServer()`, agregar:

```typescript
function isAuthorized(req: http.IncomingMessage): boolean {
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) return false; // endpoints deshabilitados si no hay token configurado
  return req.headers["x-internal-token"] === token;
}
```

- [ ] **Step 2: Aplicar verificación en los dos endpoints de /api**

Dentro del handler `http.createServer(async (req, res) => { ... })`, modificar los dos bloques:

```typescript
// ANTES:
if (req.method === "GET" && url.pathname === "/api/topes/federales") {
  await handleGetTopes(url, res);
  return;
}

if (
  req.method === "POST" &&
  url.pathname === "/api/licitaciones/evaluar-modalidad"
) {
  await handlePostEvaluarModalidad(req, res);
  return;
}

// DESPUÉS:
if (req.method === "GET" && url.pathname === "/api/topes/federales") {
  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }
  await handleGetTopes(url, res);
  return;
}

if (
  req.method === "POST" &&
  url.pathname === "/api/licitaciones/evaluar-modalidad"
) {
  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }
  await handlePostEvaluarModalidad(req, res);
  return;
}
```

- [ ] **Step 3: Documentar el env var en .env.example**

```bash
# Buscar si existe .env.example
ls apps/worker/.env.example 2>/dev/null || ls .env.example 2>/dev/null
```

Agregar la línea al archivo `.env.example` encontrado:

```
# Token para endpoints internos de la API HTTP. Si está vacío, los endpoints /api/* quedan deshabilitados.
INTERNAL_API_TOKEN=
```

- [ ] **Step 4: Verificar typecheck**

```bash
cd apps/worker && npm run typecheck
```

Expected: sin errores

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/core/http-server.ts
git add apps/worker/.env.example  # o la ruta correcta
git commit -m "fix(http-server): add token auth to /api/* endpoints"
```

---

## Task 5: Await embedding Promise chain (H1)

**Files:**
- Modify: `apps/worker/src/jobs/collect.job.ts:~499`

El bloque `Promise.all(...).then(...).catch(...)` no está await-eado, así que los embeddings se pueden perder silenciosamente si el outer handler resuelve primero.

- [ ] **Step 1: Localizar el bloque exacto**

```bash
grep -n "\.then(() => {" apps/worker/src/jobs/collect.job.ts
```

Expected: una línea alrededor de 499

- [ ] **Step 2: Agregar await**

```typescript
// ANTES:
              )
              .then(() => {
                log.info(
                  {
                    event: "RAG_MEMORY_STORED",
                    ...
                  },
                  "Embeddings del documento guardados en memoria vectorial",
                );
              })
              .catch((memoryErr) => {
                log.warn(
                  {
                    event: "RAG_MEMORY_STORE_FAILED",
                    ...
                  },
                  "No se pudo guardar memoria vectorial del documento",
                );
              });

// DESPUÉS:
              );
            log.info(
              {
                event: "RAG_MEMORY_STORED",
                procurementId,
                fileName: file.fileName,
                chunksStored: chunksForMemory.length,
              },
              "Embeddings del documento guardados en memoria vectorial",
            );
```

Nota: el bloque `Promise.all(...)` ya está con `await` para el array de inserts. Lo que falta es eliminar el `.then().catch()` flotante y en su lugar hacer el log directamente (el `.catch` del error ya está manejado por el `try/catch` del bloque exterior que captura `aiErr`). Si se quiere mantener el warn específico de memory, usar try/catch explícito:

```typescript
// Reemplazar el bloque completo (desde Promise.all hasta el .catch()):
try {
  await Promise.all(
    chunksForMemory.map(async (chunk) => {
      const embedding = await generateEmbedding(chunk);
      const { error: insertEmbeddingErr } = await db
        .from("procurement_embeddings")
        .insert({
          attachment_id: insertedAttachment.id,
          content_chunk: chunk,
          embedding,
        });

      if (insertEmbeddingErr) {
        throw new Error(insertEmbeddingErr.message);
      }
    }),
  );
  log.info(
    {
      event: "RAG_MEMORY_STORED",
      procurementId,
      fileName: file.fileName,
      chunksStored: chunksForMemory.length,
    },
    "Embeddings del documento guardados en memoria vectorial",
  );
} catch (memoryErr) {
  log.warn(
    {
      event: "RAG_MEMORY_STORE_FAILED",
      err: memoryErr,
      procurementId,
      fileName: file.fileName,
      chunksAttempted: chunksForMemory.length,
    },
    "No se pudo guardar memoria vectorial del documento",
  );
}
```

- [ ] **Step 3: Verificar typecheck**

```bash
cd apps/worker && npm run typecheck
```

Expected: sin errores

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/jobs/collect.job.ts
git commit -m "fix(collect): await embedding Promise chain to prevent silent data loss"
```

---

## Task 6: Remove puppeteer and xlsx from dependencies (H6, L2)

**Files:**
- Modify: `apps/worker/package.json`

`puppeteer` duplica el browser binary de Playwright (+300MB imagen Docker). `xlsx@0.18.5` tiene CVE-2024-22363 y aparentemente no está en uso en código de producción.

- [ ] **Step 1: Verificar que puppeteer no está en uso**

```bash
grep -r "puppeteer\|require.*puppeteer" apps/worker/src/ --include="*.ts"
```

Expected: sin resultados. Si hay resultados, NO eliminar hasta migrar esos usos a Playwright.

- [ ] **Step 2: Verificar que xlsx no está en uso en src/**

```bash
grep -r "xlsx\|require.*xlsx\|from.*xlsx" apps/worker/src/ --include="*.ts"
```

Expected: sin resultados en `src/`. Si hay uso en `scripts/`, evaluar si los scripts son necesarios.

- [ ] **Step 3: Desinstalar ambos paquetes**

```bash
cd apps/worker && npm uninstall puppeteer xlsx
```

- [ ] **Step 4: Verificar build**

```bash
cd apps/worker && npm run build
```

Expected: build exitoso sin errores de import

- [ ] **Step 5: Commit**

```bash
git add apps/worker/package.json apps/worker/package-lock.json
git commit -m "chore(deps): remove unused puppeteer and vulnerable xlsx packages"
```

---

## Task 7: Fix unescaped HTML in Telegram alerts (M2)

**Files:**
- Modify: `apps/worker/src/alerts/telegram.alerts.ts:269,271,322,324`

`p.title` y `p.dependencyName` se insertan directamente en strings con HTML parse mode sin pasar por `escapeHtml()`. Contenido scrapeado del portal puede contener `<`, `>`, `&` que corrompen el formato o inyectan HTML.

- [ ] **Step 1: Corregir primer bloque (~línea 269)**

```typescript
// ANTES:
`📌 <b>${p.title}</b>`,
"",
`🏛 <b>Dependencia:</b> ${p.dependencyName ?? "N/D"}`,

// DESPUÉS:
`📌 <b>${escapeHtml(p.title ?? "")}</b>`,
"",
`🏛 <b>Dependencia:</b> ${escapeHtml(p.dependencyName ?? "N/D")}`,
```

- [ ] **Step 2: Corregir segundo bloque (~línea 322)**

```typescript
// ANTES:
`📌 <b>${p.title}</b>`,
"",
`🏛 <b>Dependencia:</b> ${p.dependencyName ?? "N/D"}`,

// DESPUÉS:
`📌 <b>${escapeHtml(p.title ?? "")}</b>`,
"",
`🏛 <b>Dependencia:</b> ${escapeHtml(p.dependencyName ?? "N/D")}`,
```

- [ ] **Step 3: Verificar que escapeHtml está en scope**

```bash
grep -n "function escapeHtml\|const escapeHtml" apps/worker/src/alerts/telegram.alerts.ts
```

Expected: una línea alrededor de la 34

- [ ] **Step 4: Verificar typecheck**

```bash
cd apps/worker && npm run typecheck
```

Expected: sin errores

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/alerts/telegram.alerts.ts
git commit -m "fix(alerts): escape HTML in title and dependencyName to prevent injection"
```

---

## Self-Review

### Spec coverage

| Hallazgo | Task |
|---|---|
| M6: MAX_ALERTS=9999 | Task 1 ✓ |
| C3: readFileSync blocking | Task 2 ✓ |
| H5: model name wrong | Task 3 ✓ |
| C1: unauthenticated API | Task 4 ✓ |
| H1: unawaited embeddings | Task 5 ✓ |
| H6: puppeteer duplicate + L2: xlsx CVE | Task 6 ✓ |
| M2: unescaped HTML | Task 7 ✓ |

Hallazgos no cubiertos en este plan (se dejan para iteración posterior):
- C2: Prompt injection — requiere refactor de la estructura del prompt de OpenAI (trabajo mayor)
- H2: Race condition _comprasMxSourceId — requiere análisis del ciclo de vida del scheduler
- H3: Temp file leak — ya existe `finally` para la mayoría; requiere auditoría de todos los early returns
- H4: Unbounded pagination — requiere conocer el volumen real de datos y definir límite seguro
- M1, M3, M4, M5, M7, L1-L6, I1-I6 — pendientes de priorización

### Placeholder scan

Sin TBDs, TODOs, ni "similar to Task N" en el plan.

### Type consistency

`escapeHtml`, `sendJson`, `isAuthorized`, `readFile` — todos consistentes entre tasks.
