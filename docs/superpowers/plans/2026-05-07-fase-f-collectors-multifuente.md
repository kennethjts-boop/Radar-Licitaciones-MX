# Fase F — Collectors multi-fuente con scope controlado

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar cuatro collectors de fuentes públicas (CompraNet histórico, PNT/SIPOT, Contrataciones Abiertas OCDS, DOF SIDOF) con filtrado de scope integrado, y conectarlos al pipeline de enriquecimiento para mostrar antecedentes en la alerta Telegram.

**Architecture:** Cada collector vive en `src/collectors/{nombre}/index.ts`, sigue el patrón "falla silenciosamente" (nunca throw al caller, status: "unavailable" en vez), y llama a `filterProcurementScope` antes de retornar contratos. F5 integra los cuatro en `enrich-procurement.job.ts` con `Promise.allSettled` y añade una sección de antecedentes en la alerta Telegram.

**Tech Stack:** axios (ya instalado) / cheerio 1.2.0 (ya instalado) / filterProcurementScope (ya implementado) / Jest + ts-jest

---

## File Map

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `src/collectors/compranet-historico/index.ts` | Crear | CKAN API datos.gob.mx → HistoricoContract[] |
| `src/collectors/pnt-sipot/index.ts` | Crear | Refactor de scripts/historico-capufe-sipot.ts → SipotContract[] |
| `src/collectors/contrataciones-abiertas/index.ts` | Crear | OCDS API hacienda → OcdsContract[] |
| `src/collectors/dof-sidof/index.ts` | Crear | axios+cheerio scraping SIDOF → DofPublication[] |
| `src/collectors/compranet-historico/__tests__/index.test.ts` | Crear | 5 tests |
| `src/collectors/pnt-sipot/__tests__/index.test.ts` | Crear | 5 tests |
| `src/collectors/contrataciones-abiertas/__tests__/index.test.ts` | Crear | 5 tests |
| `src/collectors/dof-sidof/__tests__/index.test.ts` | Crear | 5 tests |
| `src/jobs/enrich-procurement.job.ts` | Modificar | Agregar paso 5c: antecedentes paralelos |
| `src/alerts/telegram.alerts.ts` | Modificar | `antecedentes?` en EnrichedAlertData + sección 🔎 |
| `src/alerts/__tests__/telegram.enriched.test.ts` | Modificar | 3 tests de antecedentes |
| `src/jobs/__tests__/enrich-procurement.test.ts` | Modificar | 2 tests de antecedentes integrados |

---

## Context crítico para subagentes

### filterProcurementScope (src/services/procurement-scope-filter.ts)

```typescript
import { filterProcurementScope } from "../../services/procurement-scope-filter";

// Uso en collectors:
const scopeResult = filterProcurementScope({
  state: contract.state,
  dependency: contract.dependency,
  canonical_text: `${contract.title ?? ""} ${contract.dependency ?? ""}`,
});
// scopeResult.allowed === false → excluir silenciosamente
```

### Patrón de collector (referencia)

```typescript
// Siempre: never throw, log.warn en errores, status "unavailable" si API no responde
export async function fetchXxx(query: XxxQuery): Promise<XxxResult> {
  try {
    const response = await axios.get(URL, { timeout: TIMEOUT_MS, params: {...} });
    // map + filter scope
    return { source: "xxx", contracts: filtered, status: "ok", errors: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, "xxx no disponible");
    return { source: "xxx", contracts: [], status: "unavailable", errors: [msg] };
  }
}
```

---

## Task F1: CompraNet Histórico (datos.gob.mx CKAN)

**Files:**
- Create: `src/collectors/compranet-historico/__tests__/index.test.ts`
- Create: `src/collectors/compranet-historico/index.ts`

Fuente: datos.gob.mx CKAN API. El endpoint `datastore_search` requiere un `resource_id` que apunta al dataset de contratos CompraNet. Se intenta con un resource_id configurable; si 404/timeout → `"unavailable"`.

Mapeo de campos CKAN → HistoricoContract (los campos varían por dataset, usar optional chaining):
- `NUMERO_PROCEDIMIENTO` / `numero_procedimiento` → `procedureNumber`
- `TITULO_CONTRATO` / `titulo_contrato` / `descripcion` → `title`
- `DEPENDENCIA` / `nombre_de_la_uc` → `dependency`
- `PROVEEDOR_CONTRATISTA` / `nombre_del_proveedor` → `supplier`
- `IMPORTE_CONTRATO` / `monto_del_contrato` → `awardedAmount` (parseFloat)
- `MONEDA` → `currency`
- `ANUNCIO` / `fecha_contrato` (extract year) → `year`
- `ENTIDAD_FEDERATIVA` / `entidad_federativa` → `state`
- `TIPO_PROCEDIMIENTO` → `contractType`

- [ ] **Step 1: Escribir el test**

```typescript
// src/collectors/compranet-historico/__tests__/index.test.ts
import axios from "axios";
import { fetchCompranetHistorico } from "../index";

jest.mock("axios");
const mockAxios = axios as jest.Mocked<typeof axios>;

const baseQuery = {
  keywords: ["mantenimiento", "vial"],
  scope: "MORELOS_ONLY" as const,
};

function makeCkanResponse(records: Record<string, string>[]) {
  return {
    data: {
      result: {
        records,
        total: records.length,
      },
    },
  };
}

describe("fetchCompranetHistorico", () => {
  beforeEach(() => jest.clearAllMocks());

  it("retorna contratos cuando API responde con resultados de Morelos", async () => {
    mockAxios.get.mockResolvedValue(makeCkanResponse([{
      NUMERO_PROCEDIMIENTO: "LPN-001-2023",
      TITULO_CONTRATO: "Mantenimiento vial en Morelos",
      DEPENDENCIA: "SCT",
      PROVEEDOR_CONTRATISTA: "Constructora XYZ",
      IMPORTE_CONTRATO: "1500000",
      MONEDA: "MXN",
      ANUNCIO: "2023-05-15",
      ENTIDAD_FEDERATIVA: "Morelos",
      TIPO_PROCEDIMIENTO: "Licitación Pública",
    }]));

    const result = await fetchCompranetHistorico(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0].state).toBe("Morelos");
    expect(result.contracts[0].awardedAmount).toBe(1500000);
  });

  it("filtra contratos fuera de scope (estado Jalisco)", async () => {
    mockAxios.get.mockResolvedValue(makeCkanResponse([{
      NUMERO_PROCEDIMIENTO: "LPN-002-2023",
      TITULO_CONTRATO: "Obra en Guadalajara",
      DEPENDENCIA: "SCT",
      IMPORTE_CONTRATO: "900000",
      ENTIDAD_FEDERATIVA: "Jalisco",
    }]));

    const result = await fetchCompranetHistorico(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(0);
  });

  it("retorna unavailable cuando axios lanza error", async () => {
    mockAxios.get.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await fetchCompranetHistorico(baseQuery);

    expect(result.status).toBe("unavailable");
    expect(result.contracts).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("retorna ok con array vacío cuando CKAN no devuelve records", async () => {
    mockAxios.get.mockResolvedValue(makeCkanResponse([]));

    const result = await fetchCompranetHistorico(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(0);
    expect(result.totalFound).toBe(0);
  });

  it("no hace throw en ningún caso", async () => {
    mockAxios.get.mockRejectedValue(new Error("fatal network error"));
    await expect(fetchCompranetHistorico(baseQuery)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Correr test para verificar que falla**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npx jest src/collectors/compranet-historico/__tests__/index.test.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module '../index'"

- [ ] **Step 3: Implementar `src/collectors/compranet-historico/index.ts`**

```typescript
/**
 * COMPRANET HISTÓRICO — Consulta el dataset público de contratos en datos.gob.mx (CKAN).
 * Falla silenciosamente: si la API no responde → status "unavailable", nunca throw.
 */
import axios from "axios";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { filterProcurementScope } from "../../services/procurement-scope-filter";

const log = createModuleLogger("compranet-historico");

const CKAN_BASE_URL = "https://datos.gob.mx/busca/api/3/action/datastore_search";
// Resource ID del dataset de contratos CompraNet (configurable vía env)
const RESOURCE_ID =
  process.env.COMPRANET_RESOURCE_ID ?? "30e5e2fd-78dc-426b-9fef-98c9b3bdb6bc";
const TIMEOUT_MS = 15_000;
const RATE_LIMIT_MS = 2_000;

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface HistoricoQuery {
  keywords: string[];
  dependency?: string | null;
  scope: "MORELOS_ONLY" | "NATIONAL_CAPUFE_DESIERTA";
  yearFrom?: number;
  yearTo?: number;
  maxResults?: number;
}

export interface HistoricoContract {
  procedureNumber: string | null;
  title: string | null;
  dependency: string | null;
  supplier: string | null;
  awardedAmount: number | null;
  currency: string | null;
  year: number | null;
  state: string | null;
  contractType: string | null;
  sourceUrl: string | null;
  retrievedAt: string;
}

export interface HistoricoResult {
  source: "compranet-historico";
  query: HistoricoQuery;
  contracts: HistoricoContract[];
  totalFound: number;
  status: "ok" | "partial" | "error" | "unavailable";
  errors: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseYear(dateStr: string | undefined | null): number | null {
  if (!dateStr) return null;
  const match = String(dateStr).match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

function parseAmount(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function mapRecord(record: Record<string, unknown>): HistoricoContract {
  const get = (keys: string[]): string | null => {
    for (const k of keys) {
      const v = record[k] ?? record[k.toLowerCase()];
      if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
    }
    return null;
  };

  return {
    procedureNumber: get(["NUMERO_PROCEDIMIENTO", "numero_procedimiento", "NUMERO_CONTRATO"]),
    title: get(["TITULO_CONTRATO", "titulo_contrato", "DESCRIPCION", "descripcion"]),
    dependency: get(["DEPENDENCIA", "dependencia", "NOMBRE_DE_LA_UC", "nombre_de_la_uc"]),
    supplier: get(["PROVEEDOR_CONTRATISTA", "proveedor_contratista", "NOMBRE_DEL_PROVEEDOR"]),
    awardedAmount: parseAmount(get(["IMPORTE_CONTRATO", "importe_contrato", "MONTO_DEL_CONTRATO"])),
    currency: get(["MONEDA", "moneda"]),
    year: parseYear(get(["ANUNCIO", "FECHA_CONTRATO", "fecha_contrato"])),
    state: get(["ENTIDAD_FEDERATIVA", "entidad_federativa", "ESTADO"]),
    contractType: get(["TIPO_PROCEDIMIENTO", "tipo_procedimiento"]),
    sourceUrl: `${CKAN_BASE_URL}?resource_id=${RESOURCE_ID}`,
    retrievedAt: nowISO(),
  };
}

// ── Función principal ──────────────────────────────────────────────────────────

export async function fetchCompranetHistorico(
  query: HistoricoQuery,
): Promise<HistoricoResult> {
  const maxResults = query.maxResults ?? 20;
  const searchQuery = query.keywords.join(" ");

  const base: HistoricoResult = {
    source: "compranet-historico",
    query,
    contracts: [],
    totalFound: 0,
    status: "unavailable",
    errors: [],
  };

  try {
    log.info({ keywords: query.keywords, scope: query.scope }, "🔍 fetchCompranetHistorico iniciado");

    const response = await axios.get(CKAN_BASE_URL, {
      timeout: TIMEOUT_MS,
      params: {
        resource_id: RESOURCE_ID,
        q: searchQuery,
        limit: maxResults,
      },
    });

    const result = response.data?.result;
    const records: Record<string, unknown>[] = Array.isArray(result?.records)
      ? result.records
      : [];
    const total: number = result?.total ?? records.length;

    // Pequeño rate-limit post-request para ser buenos ciudadanos
    if (process.env.NODE_ENV !== "test") {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }

    // Mapear y filtrar por scope
    const mapped = records.map(mapRecord);
    const filtered = mapped.filter((c) => {
      const scopeResult = filterProcurementScope({
        state: c.state,
        dependency: c.dependency,
        canonical_text: `${c.title ?? ""} ${c.dependency ?? ""}`,
      });
      return scopeResult.allowed;
    });

    // Filtrar por año si se especificó
    const yearFiltered = filtered.filter((c) => {
      if (query.yearFrom && c.year && c.year < query.yearFrom) return false;
      if (query.yearTo && c.year && c.year > query.yearTo) return false;
      return true;
    });

    log.info(
      { total, mapped: mapped.length, filtered: yearFiltered.length },
      "✅ fetchCompranetHistorico completado",
    );

    return {
      ...base,
      contracts: yearFiltered,
      totalFound: total,
      status: "ok",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, keywords: query.keywords }, "⚠️ CompraNet histórico no disponible");
    return { ...base, status: "unavailable", errors: [msg] };
  }
}
```

- [ ] **Step 4: Correr tests**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX/apps/worker" && npx jest src/collectors/compranet-historico/__tests__/index.test.ts --no-coverage
```

Expected: PASS — 5/5

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX" && git add apps/worker/src/collectors/compranet-historico/ && git commit -m "feat: F1 — agregar fetchCompranetHistorico (datos.gob.mx CKAN)"
```

---

## Task F2: PNT SIPOT (refactor del script)

**Files:**
- Create: `src/collectors/pnt-sipot/__tests__/index.test.ts`
- Create: `src/collectors/pnt-sipot/index.ts`

Refactoriza `src/scripts/historico-capufe-sipot.ts` como servicio sin I/O a disco ni Telegram.
Endpoint POST: `https://backbuscadortematico.plataformadetransparencia.org.mx/api/tematico/buscador/consulta`

El response tiene `payload.datosSolr` o `paylod.datosSolr` (typo del servidor — mantener ambos).

`SipotContract` extiende `HistoricoContract` (importar desde `../compranet-historico/index`):
```typescript
export interface SipotContract extends HistoricoContract {
  expedienteId: string | null;
  procedureType: string | null;
}
```

Mapeo de campos SIPOT → SipotContract:
- `numeroContrato` / `objeto` / `nombreContratista` → usar pattern similar al script existente
- `montoContrato` / `montoTotal` → `awardedAmount`
- `fechaContrato` / `fechaCelebracion` → extract year
- `nombreSujetoObligado` / `institucion` → `dependency`
- Dedup por `(proveedor + objeto)` igual que el script

- [ ] **Step 1: Escribir el test**

```typescript
// src/collectors/pnt-sipot/__tests__/index.test.ts
import axios from "axios";
import { fetchPntSipot } from "../index";

jest.mock("axios");
const mockAxios = axios as jest.Mocked<typeof axios>;

const baseQuery = {
  keywords: ["mantenimiento", "vial"],
  scope: "MORELOS_ONLY" as const,
};

function makeSipotResponse(records: Record<string, unknown>[]) {
  return {
    data: {
      payload: {
        datosSolr: records,
      },
    },
  };
}

describe("fetchPntSipot", () => {
  beforeEach(() => jest.clearAllMocks());

  it("retorna contratos de Morelos", async () => {
    mockAxios.post.mockResolvedValue(makeSipotResponse([{
      objetoContrato: "Mantenimiento de carretera en Cuernavaca Morelos",
      nombreContratista: "Empresa ABC",
      montoContrato: "2500000",
      fechaContrato: "2023-03-10",
      nombreSujetoObligado: "SCT",
      numeroContrato: "SIPOT-001",
    }]));

    const result = await fetchPntSipot(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0].title).toContain("Morelos");
  });

  it("filtra contratos fuera de scope", async () => {
    mockAxios.post.mockResolvedValue(makeSipotResponse([{
      objetoContrato: "Obra en Monterrey Nuevo León sin relación",
      nombreContratista: "Empresa XYZ",
      montoContrato: "1000000",
      fechaContrato: "2023-01-01",
      nombreSujetoObligado: "IMSS",
    }]));

    const result = await fetchPntSipot(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(0);
  });

  it("maneja typo del servidor: paylod.datosSolr", async () => {
    mockAxios.post.mockResolvedValue({
      data: { paylod: { datosSolr: [{ objetoContrato: "Mantenimiento en Morelos", montoContrato: "500000" }] } },
    });

    const result = await fetchPntSipot(baseQuery);
    expect(result.status).toBe("ok");
  });

  it("retorna unavailable cuando axios lanza", async () => {
    mockAxios.post.mockRejectedValue(new Error("Network timeout"));

    const result = await fetchPntSipot(baseQuery);

    expect(result.status).toBe("unavailable");
    expect(result.contracts).toHaveLength(0);
  });

  it("no hace throw en ningún caso", async () => {
    mockAxios.post.mockRejectedValue(new Error("fatal"));
    await expect(fetchPntSipot(baseQuery)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Correr test para verificar que falla**

```bash
npx jest src/collectors/pnt-sipot/__tests__/index.test.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module '../index'"

- [ ] **Step 3: Implementar `src/collectors/pnt-sipot/index.ts`**

```typescript
/**
 * PNT SIPOT — Consulta el buscador temático de la Plataforma Nacional de Transparencia.
 * Refactored from src/scripts/historico-capufe-sipot.ts como servicio sin I/O.
 * Falla silenciosamente: status "unavailable" si la API no responde.
 */
import axios from "axios";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { filterProcurementScope } from "../../services/procurement-scope-filter";
import type { HistoricoContract } from "../compranet-historico/index";

const log = createModuleLogger("pnt-sipot");

const ENDPOINT_URL =
  "https://backbuscadortematico.plataformadetransparencia.org.mx/api/tematico/buscador/consulta";
const TIMEOUT_MS = 20_000;
const RATE_LIMIT_MS = 3_000;

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface SipotQuery {
  keywords: string[];
  dependency?: string | null;
  scope: "MORELOS_ONLY" | "NATIONAL_CAPUFE_DESIERTA";
  maxResults?: number;
}

export interface SipotContract extends HistoricoContract {
  expedienteId: string | null;
  procedureType: string | null;
}

export interface SipotResult {
  source: "pnt-sipot";
  query: SipotQuery;
  contracts: SipotContract[];
  status: "ok" | "partial" | "error" | "unavailable";
  errors: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseYear(dateStr: string | undefined | null): number | null {
  if (!dateStr) return null;
  const match = String(dateStr).match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

function parseAmount(raw: unknown): number | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function getField(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = record[k];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return null;
}

function mapSipotRecord(record: Record<string, unknown>): SipotContract {
  return {
    procedureNumber: getField(record, "numeroContrato", "numeroExpediente"),
    title: getField(record, "objetoContrato", "descripcion", "concepto", "titulo"),
    dependency: getField(record, "nombreSujetoObligado", "institucion", "dependencia"),
    supplier: getField(record, "nombreContratista", "proveedor", "nombreComercial"),
    awardedAmount: parseAmount(
      getField(record, "montoContrato", "montoTotal", "montoMaximo"),
    ),
    currency: getField(record, "moneda") ?? "MXN",
    year: parseYear(getField(record, "fechaContrato", "fechaCelebracion", "fechaInicio")),
    state: getField(record, "entidadFederativa", "estado"),
    contractType: getField(record, "tipoProcedimiento", "tipoContratacion"),
    sourceUrl: ENDPOINT_URL,
    retrievedAt: nowISO(),
    expedienteId: getField(record, "expediente", "idExpediente"),
    procedureType: getField(record, "tipoProcedimiento", "modalidad"),
  };
}

// ── Función principal ──────────────────────────────────────────────────────────

export async function fetchPntSipot(query: SipotQuery): Promise<SipotResult> {
  const maxResults = query.maxResults ?? 20;
  const searchQuery = query.keywords.join(" ");

  const base: SipotResult = {
    source: "pnt-sipot",
    query,
    contracts: [],
    status: "unavailable",
    errors: [],
  };

  try {
    log.info({ keywords: query.keywords, scope: query.scope }, "🔍 fetchPntSipot iniciado");

    const payload = {
      contenido: searchQuery,
      cantidad: maxResults,
      numeroPagina: 0,
      coleccion: "CONTRATOS",
      dePaginador: false,
      filtroSeleccionado: "",
      idCompartido: "",
      organosGarantes: { seleccion: [], descartado: [] },
      sujetosObligados: { seleccion: [], descartado: [] },
      anioFechaInicio: { seleccion: [], descartado: [] },
      tipoOrdenamiento: "COINCIDENCIA",
    };

    const response = await axios.post(ENDPOINT_URL, payload, { timeout: TIMEOUT_MS });

    // El servidor tiene un typo: "paylod" en vez de "payload" — soportar ambos
    const rawRecords: unknown[] =
      response.data?.payload?.datosSolr ??
      response.data?.paylod?.datosSolr ??
      [];
    const records: Record<string, unknown>[] = Array.isArray(rawRecords) ? rawRecords : [];

    if (process.env.NODE_ENV !== "test") {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }

    const mapped = records.map(mapSipotRecord);
    const filtered = mapped.filter((c) => {
      const scopeResult = filterProcurementScope({
        state: c.state,
        dependency: c.dependency,
        canonical_text: `${c.title ?? ""} ${c.dependency ?? ""}`,
      });
      return scopeResult.allowed;
    });

    log.info(
      { raw: records.length, filtered: filtered.length },
      "✅ fetchPntSipot completado",
    );

    return { ...base, contracts: filtered, status: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, "⚠️ PNT SIPOT no disponible");
    return { ...base, status: "unavailable", errors: [msg] };
  }
}
```

- [ ] **Step 4: Correr tests**

```bash
npx jest src/collectors/pnt-sipot/__tests__/index.test.ts --no-coverage
```

Expected: PASS — 5/5

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX" && git add apps/worker/src/collectors/pnt-sipot/ && git commit -m "feat: F2 — agregar fetchPntSipot (refactor de script SIPOT)"
```

---

## Task F3: Contrataciones Abiertas (OCDS)

**Files:**
- Create: `src/collectors/contrataciones-abiertas/__tests__/index.test.ts`
- Create: `src/collectors/contrataciones-abiertas/index.ts`

Fuente: API OCDS de CompraNet Hacienda.
URL: `https://api.compranet.hacienda.gob.mx/ocds/api/v1/records`
Query params: `_q` (keywords), `pageSize` (default 20).

Response OCDS: array de `records`, cada uno con `compiledRelease` que contiene:
- `compiledRelease.ocid` → `ocid`
- `compiledRelease.tender.id` → `procedureNumber`
- `compiledRelease.tender.title` → `title`
- `compiledRelease.buyer.name` → `dependency`
- `compiledRelease.awards[0].suppliers[0].name` → `supplier`
- `compiledRelease.awards[0].value.amount` → `awardedAmount`
- `compiledRelease.awards[0].value.currency` → `currency`
- `compiledRelease.tender.datePublished` (extract year) → `year`

Para `state`: buscar en `compiledRelease.planning.budget.description` o `tender.description`.

- [ ] **Step 1: Escribir el test**

```typescript
// src/collectors/contrataciones-abiertas/__tests__/index.test.ts
import axios from "axios";
import { fetchContratacionesAbiertas } from "../index";

jest.mock("axios");
const mockAxios = axios as jest.Mocked<typeof axios>;

const baseQuery = {
  keywords: ["mantenimiento", "carretera"],
  scope: "MORELOS_ONLY" as const,
};

function makeOcdsResponse(records: Record<string, unknown>[]) {
  return { data: { records } };
}

function makeOcdsRecord(title: string, state: string, amount: number) {
  return {
    compiledRelease: {
      ocid: "ocds-mx-001",
      tender: {
        id: "LPN-2023-001",
        title,
        datePublished: "2023-06-01",
        description: `Obra en ${state}`,
      },
      buyer: { name: "SCT" },
      awards: [{ suppliers: [{ name: "Empresa SA" }], value: { amount, currency: "MXN" } }],
    },
  };
}

describe("fetchContratacionesAbiertas", () => {
  beforeEach(() => jest.clearAllMocks());

  it("retorna contratos de Morelos", async () => {
    mockAxios.get.mockResolvedValue(
      makeOcdsResponse([makeOcdsRecord("Mantenimiento en Cuernavaca Morelos", "Morelos", 1800000)])
    );

    const result = await fetchContratacionesAbiertas(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0].awardedAmount).toBe(1800000);
  });

  it("filtra contratos fuera de scope", async () => {
    mockAxios.get.mockResolvedValue(
      makeOcdsResponse([makeOcdsRecord("Obra en Sonora sin relación", "Sonora", 500000)])
    );

    const result = await fetchContratacionesAbiertas(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(0);
  });

  it("retorna unavailable cuando axios lanza", async () => {
    mockAxios.get.mockRejectedValue(new Error("503 Service Unavailable"));

    const result = await fetchContratacionesAbiertas(baseQuery);

    expect(result.status).toBe("unavailable");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("retorna ok con vacío cuando no hay records", async () => {
    mockAxios.get.mockResolvedValue(makeOcdsResponse([]));

    const result = await fetchContratacionesAbiertas(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.contracts).toHaveLength(0);
  });

  it("no hace throw en ningún caso", async () => {
    mockAxios.get.mockRejectedValue(new Error("fatal"));
    await expect(fetchContratacionesAbiertas(baseQuery)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Correr test para verificar que falla**

```bash
npx jest src/collectors/contrataciones-abiertas/__tests__/index.test.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL

- [ ] **Step 3: Implementar `src/collectors/contrataciones-abiertas/index.ts`**

```typescript
/**
 * CONTRATACIONES ABIERTAS — Consulta la API OCDS de CompraNet Hacienda.
 * Falla silenciosamente: status "unavailable" si la API no responde.
 */
import axios from "axios";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { filterProcurementScope } from "../../services/procurement-scope-filter";

const log = createModuleLogger("contrataciones-abiertas");

const OCDS_URL = "https://api.compranet.hacienda.gob.mx/ocds/api/v1/records";
const TIMEOUT_MS = 15_000;
const RATE_LIMIT_MS = 2_000;

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface OcdsQuery {
  keywords: string[];
  dependency?: string | null;
  scope: "MORELOS_ONLY" | "NATIONAL_CAPUFE_DESIERTA";
  maxResults?: number;
}

export interface OcdsContract {
  ocid: string | null;
  procedureNumber: string | null;
  title: string | null;
  dependency: string | null;
  supplier: string | null;
  awardedAmount: number | null;
  currency: string | null;
  year: number | null;
  state: string | null;
  status: string | null;
  sourceUrl: string | null;
  retrievedAt: string;
}

export interface OcdsResult {
  source: "contrataciones-abiertas";
  contracts: OcdsContract[];
  status: "ok" | "partial" | "error" | "unavailable";
  errors: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseYear(dateStr: string | undefined | null): number | null {
  if (!dateStr) return null;
  const match = String(dateStr).match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

function extractStateFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  // Buscar nombres de estados mexicanos en el texto
  const STATES = [
    "Morelos", "Jalisco", "Sonora", "Chihuahua", "Veracruz", "Oaxaca",
    "Guerrero", "Puebla", "Hidalgo", "Estado de México", "Ciudad de México",
    "CDMX", "Aguascalientes", "Baja California", "Colima", "Durango",
    "Guanajuato", "Michoacán", "Nayarit", "Nuevo León", "Querétaro",
    "Quintana Roo", "San Luis Potosí", "Sinaloa", "Tabasco", "Tamaulipas",
    "Tlaxcala", "Yucatán", "Zacatecas", "Campeche", "Coahuila",
  ];
  for (const s of STATES) {
    if (text.toLowerCase().includes(s.toLowerCase())) return s;
  }
  return null;
}

function mapOcdsRecord(record: Record<string, unknown>): OcdsContract {
  const release = (record.compiledRelease ?? {}) as Record<string, unknown>;
  const tender = (release.tender ?? {}) as Record<string, unknown>;
  const buyer = (release.buyer ?? {}) as Record<string, unknown>;
  const awards = Array.isArray(release.awards) ? release.awards as Record<string, unknown>[] : [];
  const firstAward = awards[0] as Record<string, unknown> | undefined;
  const firstSuppliers = Array.isArray(firstAward?.suppliers)
    ? (firstAward.suppliers as Record<string, unknown>[])[0]
    : undefined;
  const value = firstAward?.value as Record<string, unknown> | undefined;

  const titleStr = tender.title as string | undefined;
  const descStr = tender.description as string | undefined;
  const stateFromText = extractStateFromText(titleStr) ?? extractStateFromText(descStr);

  return {
    ocid: (release.ocid as string) ?? null,
    procedureNumber: (tender.id as string) ?? null,
    title: titleStr ?? null,
    dependency: (buyer.name as string) ?? null,
    supplier: (firstSuppliers?.name as string) ?? null,
    awardedAmount: typeof value?.amount === "number" ? value.amount : null,
    currency: (value?.currency as string) ?? null,
    year: parseYear(tender.datePublished as string),
    state: stateFromText,
    status: (tender.status as string) ?? null,
    sourceUrl: OCDS_URL,
    retrievedAt: nowISO(),
  };
}

// ── Función principal ──────────────────────────────────────────────────────────

export async function fetchContratacionesAbiertas(
  query: OcdsQuery,
): Promise<OcdsResult> {
  const maxResults = query.maxResults ?? 20;
  const searchQuery = query.keywords.join(" ");

  const base: OcdsResult = {
    source: "contrataciones-abiertas",
    contracts: [],
    status: "unavailable",
    errors: [],
  };

  try {
    log.info({ keywords: query.keywords, scope: query.scope }, "🔍 fetchContratacionesAbiertas iniciado");

    const response = await axios.get(OCDS_URL, {
      timeout: TIMEOUT_MS,
      params: {
        _q: searchQuery,
        pageSize: maxResults,
      },
    });

    const rawRecords: unknown[] = Array.isArray(response.data?.records)
      ? response.data.records
      : [];

    if (process.env.NODE_ENV !== "test") {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }

    const mapped = (rawRecords as Record<string, unknown>[]).map(mapOcdsRecord);
    const filtered = mapped.filter((c) => {
      const scopeResult = filterProcurementScope({
        state: c.state,
        dependency: c.dependency,
        canonical_text: `${c.title ?? ""} ${c.dependency ?? ""}`,
      });
      return scopeResult.allowed;
    });

    log.info(
      { raw: rawRecords.length, filtered: filtered.length },
      "✅ fetchContratacionesAbiertas completado",
    );

    return { ...base, contracts: filtered, status: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, "⚠️ Contrataciones abiertas no disponible");
    return { ...base, status: "unavailable", errors: [msg] };
  }
}
```

- [ ] **Step 4: Correr tests**

```bash
npx jest src/collectors/contrataciones-abiertas/__tests__/index.test.ts --no-coverage
```

Expected: PASS — 5/5

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX" && git add apps/worker/src/collectors/contrataciones-abiertas/ && git commit -m "feat: F3 — agregar fetchContratacionesAbiertas (OCDS Hacienda)"
```

---

## Task F4: DOF SIDOF (axios + cheerio)

**Files:**
- Create: `src/collectors/dof-sidof/__tests__/index.test.ts`
- Create: `src/collectors/dof-sidof/index.ts`

Fuente: búsqueda pública del DOF en SIDOF.
URL base: `https://sidof.segob.gob.mx/notas/buscar`
Método: GET con query param `busqueda=keywords` (o POST con form — manejar ambos casos).

El HTML retornado contiene una tabla o lista de publicaciones. Parsear con cheerio.
Para scope filtering: usar el `title` y `dependency` de cada publicación.

> **Nota:** Si la estructura del HTML cambia o la URL retorna error → status "unavailable".

- [ ] **Step 1: Escribir el test**

```typescript
// src/collectors/dof-sidof/__tests__/index.test.ts
import axios from "axios";
import { fetchDofSidof } from "../index";

jest.mock("axios");
const mockAxios = axios as jest.Mocked<typeof axios>;

const baseQuery = {
  keywords: ["mantenimiento", "Morelos"],
  scope: "MORELOS_ONLY" as const,
};

// Minimal HTML that a real SIDOF response might look like
const MORELOS_HTML = `
<html><body>
<div class="nota-item">
  <h3 class="nota-titulo"><a href="/nota/12345">Licitación mantenimiento vial Morelos</a></h3>
  <span class="nota-dependencia">SICT</span>
  <span class="nota-fecha">07/05/2026</span>
</div>
</body></html>
`;

const JALISCO_HTML = `
<html><body>
<div class="nota-item">
  <h3 class="nota-titulo"><a href="/nota/99999">Concurso obra Guadalajara Jalisco</a></h3>
  <span class="nota-dependencia">IMSS</span>
  <span class="nota-fecha">07/05/2026</span>
</div>
</body></html>
`;

const EMPTY_HTML = `<html><body><p>No se encontraron resultados.</p></body></html>`;

describe("fetchDofSidof", () => {
  beforeEach(() => jest.clearAllMocks());

  it("retorna publicaciones de Morelos", async () => {
    mockAxios.get.mockResolvedValue({ data: MORELOS_HTML });

    const result = await fetchDofSidof(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.publications).toHaveLength(1);
    expect(result.publications[0].title).toContain("Morelos");
  });

  it("filtra publicaciones fuera de scope", async () => {
    mockAxios.get.mockResolvedValue({ data: JALISCO_HTML });

    const result = await fetchDofSidof(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.publications).toHaveLength(0);
  });

  it("retorna ok vacío si HTML no tiene resultados", async () => {
    mockAxios.get.mockResolvedValue({ data: EMPTY_HTML });

    const result = await fetchDofSidof(baseQuery);

    expect(result.status).toBe("ok");
    expect(result.publications).toHaveLength(0);
  });

  it("retorna unavailable cuando axios lanza", async () => {
    mockAxios.get.mockRejectedValue(new Error("Connection refused"));

    const result = await fetchDofSidof(baseQuery);

    expect(result.status).toBe("unavailable");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("no hace throw en ningún caso", async () => {
    mockAxios.get.mockRejectedValue(new Error("fatal"));
    await expect(fetchDofSidof(baseQuery)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Correr test para verificar que falla**

```bash
npx jest src/collectors/dof-sidof/__tests__/index.test.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL

- [ ] **Step 3: Implementar `src/collectors/dof-sidof/index.ts`**

```typescript
/**
 * DOF SIDOF — Scraping legal del buscador público del Diario Oficial de la Federación.
 * Usa axios + cheerio (sin Playwright). Falla silenciosamente.
 */
import axios from "axios";
import * as cheerio from "cheerio";
import { createModuleLogger } from "../../core/logger";
import { nowISO } from "../../core/time";
import { filterProcurementScope } from "../../services/procurement-scope-filter";

const log = createModuleLogger("dof-sidof");

const SIDOF_URL = "https://sidof.segob.gob.mx/notas/buscar";
const TIMEOUT_MS = 10_000;
const RATE_LIMIT_MS = 3_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface DofQuery {
  keywords: string[];
  scope: "MORELOS_ONLY" | "NATIONAL_CAPUFE_DESIERTA";
  maxResults?: number;
}

export interface DofPublication {
  title: string | null;
  dependency: string | null;
  publicationDate: string | null;
  dofUrl: string | null;
  procedureNumber: string | null;
  retrievedAt: string;
}

export interface DofResult {
  source: "dof-sidof";
  publications: DofPublication[];
  status: "ok" | "partial" | "error" | "unavailable";
  errors: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractProcedureNumber(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/(?:LPN|LPI|AD|INV|ITP)[-\s]?\d[\d\-\/A-Z]*/i);
  return match ? match[0].trim() : null;
}

function parsePublications(html: string, baseUrl: string, maxResults: number): DofPublication[] {
  const $ = cheerio.load(html);
  const results: DofPublication[] = [];
  const now = nowISO();

  // Intentar múltiples selectores para adaptarse a cambios en el HTML
  const itemSelectors = [
    ".nota-item",
    "article",
    ".result-item",
    "li.search-result",
    "tr.result",
  ];

  let $items: cheerio.Cheerio<cheerio.Element> | null = null;
  for (const sel of itemSelectors) {
    const found = $(sel);
    if (found.length > 0) {
      $items = found;
      break;
    }
  }

  if (!$items || $items.length === 0) return [];

  $items.each((_, el) => {
    if (results.length >= maxResults) return false;

    const $el = $(el);

    const titleEl = $el.find("h3, h2, .nota-titulo, .titulo, a").first();
    const title = titleEl.text().trim() || null;

    const href = titleEl.find("a").attr("href") ?? titleEl.attr("href") ?? null;
    const dofUrl = href
      ? href.startsWith("http")
        ? href
        : `${new URL(baseUrl).origin}${href}`
      : null;

    const dependency =
      $el.find(".nota-dependencia, .dependencia, .organismo").first().text().trim() || null;

    const dateText =
      $el.find(".nota-fecha, .fecha, time").first().text().trim() || null;

    results.push({
      title,
      dependency,
      publicationDate: dateText,
      dofUrl,
      procedureNumber: extractProcedureNumber(title),
      retrievedAt: now,
    });
  });

  return results;
}

// ── Función principal ──────────────────────────────────────────────────────────

export async function fetchDofSidof(query: DofQuery): Promise<DofResult> {
  const maxResults = query.maxResults ?? 20;
  const searchQuery = query.keywords.join(" ");

  const base: DofResult = {
    source: "dof-sidof",
    publications: [],
    status: "unavailable",
    errors: [],
  };

  try {
    log.info({ keywords: query.keywords, scope: query.scope }, "🔍 fetchDofSidof iniciado");

    const response = await axios.get(SIDOF_URL, {
      timeout: TIMEOUT_MS,
      params: { busqueda: searchQuery },
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (process.env.NODE_ENV !== "test") {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }

    const html: string = typeof response.data === "string" ? response.data : "";
    const raw = parsePublications(html, SIDOF_URL, maxResults);

    // Filtrar por scope usando título y dependencia como canonical_text
    const filtered = raw.filter((pub) => {
      const scopeResult = filterProcurementScope({
        dependency: pub.dependency,
        canonical_text: `${pub.title ?? ""} ${pub.dependency ?? ""}`,
      });
      return scopeResult.allowed;
    });

    log.info(
      { raw: raw.length, filtered: filtered.length },
      "✅ fetchDofSidof completado",
    );

    return { ...base, publications: filtered, status: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, "⚠️ DOF SIDOF no disponible");
    return { ...base, status: "unavailable", errors: [msg] };
  }
}
```

- [ ] **Step 4: Correr tests**

```bash
npx jest src/collectors/dof-sidof/__tests__/index.test.ts --no-coverage
```

If the HTML parsing tests fail, check that cheerio 1.x is using `cheerio.load(html)` (not the cheerio 0.x `require('cheerio').load()` pattern). The import `import * as cheerio from "cheerio"` is correct for cheerio 1.x.

Expected: PASS — 5/5

- [ ] **Step 5: Correr todos los tests (regresión)**

```bash
npm test -- --no-coverage
```

Expected: ≥ 227 tests, 0 failing.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX" && git add apps/worker/src/collectors/dof-sidof/ && git commit -m "feat: F4 — agregar fetchDofSidof (axios+cheerio SIDOF)"
```

---

## Task F5: Integration — Antecedentes en el pipeline de enriquecimiento

**Files:**
- Modify: `src/jobs/enrich-procurement.job.ts`
- Modify: `src/alerts/telegram.alerts.ts`
- Modify: `src/alerts/__tests__/telegram.enriched.test.ts`
- Modify: `src/jobs/__tests__/enrich-procurement.test.ts`

### Cambios en `telegram.alerts.ts`

Agregar `antecedentes?` a `EnrichedAlertData` y una sección 🔎 en `formatEnrichedAlert` (en AMBAS ramas: con-docs y sin-docs), colocada justo **después** de `budgetSignal` y **antes** de `errors`.

- [ ] **Step 1: Agregar tests al archivo `telegram.enriched.test.ts`**

Agregar al final del `describe("formatEnrichedAlert")` (antes del cierre `}`):

```typescript
  it("muestra sección de antecedentes cuando hay contratos", () => {
    const msg = formatEnrichedAlert({
      ...baseData,
      antecedentes: { compranetCount: 3, compranetHighestAmount: 2500000, sipotCount: 1, ocdsCount: 0 },
    });
    expect(msg).toContain("🔎");
    expect(msg).toContain("CompraNet");
    expect(msg).toContain("2,500,000");
  });

  it("muestra 'Sin antecedentes' cuando todos son 0", () => {
    const msg = formatEnrichedAlert({
      ...baseData,
      antecedentes: { compranetCount: 0, compranetHighestAmount: null, sipotCount: 0, ocdsCount: 0 },
    });
    expect(msg).toContain("🔎");
    expect(msg).toContain("Sin antecedentes");
  });

  it("no muestra sección de antecedentes si antecedentes es undefined", () => {
    const msg = formatEnrichedAlert({ ...baseData });
    expect(msg).not.toContain("Antecedentes encontrados");
  });
```

- [ ] **Step 2: Verificar que los nuevos tests fallan**

```bash
npx jest src/alerts/__tests__/telegram.enriched.test.ts --no-coverage 2>&1 | grep "Tests:"
```

Expected: 3 tests failing (antecedentes no existe aún).

- [ ] **Step 3: Actualizar `EnrichedAlertData` en `telegram.alerts.ts`**

Agregar al final de la interfaz (después de `budgetSignal?`):

```typescript
  antecedentes?: {
    compranetCount: number;
    compranetHighestAmount: number | null;
    sipotCount: number;
    ocdsCount: number;
  };
```

- [ ] **Step 4: Agregar sección antecedentes en `formatEnrichedAlert`**

En AMBAS ramas (sin-docs y con-docs), agregar el bloque siguiente DESPUÉS del bloque `budgetSignal` y ANTES del bloque `errors`. El bloque a insertar es el mismo en ambos lugares:

```typescript
  if (data.antecedentes !== undefined) {
    const a = data.antecedentes;
    const total = a.compranetCount + a.sipotCount + a.ocdsCount;
    lines.push("");
    if (total === 0) {
      lines.push("🔎 <b>Antecedentes:</b> Sin antecedentes directos en fuentes públicas consultadas.");
    } else {
      lines.push("🔎 <b>Antecedentes encontrados:</b>");
      const compranetSuffix =
        a.compranetCount > 0 && a.compranetHighestAmount !== null
          ? ` — mayor: ${formatCurrency(a.compranetHighestAmount, "MXN")}`
          : "";
      lines.push(`  • CompraNet: ${a.compranetCount} contratos${compranetSuffix}`);
      lines.push(`  • SIPOT/PNT: ${a.sipotCount} registros`);
      lines.push(`  • OCDS: ${a.ocdsCount} registros`);
    }
  }
```

- [ ] **Step 5: Correr telegram.enriched tests**

```bash
npx jest src/alerts/__tests__/telegram.enriched.test.ts --no-coverage
```

Expected: PASS — 12/12 (9 existentes + 3 nuevos)

### Cambios en `enrich-procurement.job.ts`

- [ ] **Step 6: Escribir tests nuevos para enrich-procurement.test.ts**

Al inicio del archivo (después de los mocks existentes de parsers), agregar mocks para los 3 collectors:

```typescript
jest.mock("../../collectors/compranet-historico/index");
jest.mock("../../collectors/pnt-sipot/index");
jest.mock("../../collectors/contrataciones-abiertas/index");

import { fetchCompranetHistorico } from "../../collectors/compranet-historico/index";
import { fetchPntSipot } from "../../collectors/pnt-sipot/index";
import { fetchContratacionesAbiertas } from "../../collectors/contrataciones-abiertas/index";

const mockedCompranet = fetchCompranetHistorico as jest.MockedFunction<typeof fetchCompranetHistorico>;
const mockedSipot = fetchPntSipot as jest.MockedFunction<typeof fetchPntSipot>;
const mockedOcds = fetchContratacionesAbiertas as jest.MockedFunction<typeof fetchContratacionesAbiertas>;
```

En el `beforeEach`, agregar defaults para los mocks:

```typescript
    mockedCompranet.mockResolvedValue({ source: "compranet-historico", query: {} as any, contracts: [], totalFound: 0, status: "ok", errors: [] });
    mockedSipot.mockResolvedValue({ source: "pnt-sipot", query: {} as any, contracts: [], status: "ok", errors: [] });
    mockedOcds.mockResolvedValue({ source: "contrataciones-abiertas", contracts: [], status: "ok", errors: [] });
```

Agregar al final del describe (antes del cierre `}`):

```typescript
  it("llama a los 3 collectors de antecedentes cuando hay documentos", async () => {
    const url = "https://example.com/bases.pdf";
    mockedCollect.mockResolvedValue(makeCollectorResult([{ title: "Bases", fileUrl: url }]));
    mockedDownload.mockResolvedValue(makeDownloadResults([url], ["ok"]));
    mockedParsePdf.mockResolvedValue({ text: "Mantenimiento vial Morelos.", parseStatus: "ok", errors: [] });
    mockedExtractBudget.mockReturnValue({ signals: [], hasSignals: false, highestAmount: null });
    mockedCompranet.mockResolvedValue({
      source: "compranet-historico",
      query: {} as any,
      contracts: [{ procedureNumber: "LPN-001", title: "Mantenimiento", dependency: "SCT",
        supplier: "EmpresaABC", awardedAmount: 1200000, currency: "MXN", year: 2023,
        state: "Morelos", contractType: "LP", sourceUrl: null, retrievedAt: "2026-05-07T00:00:00Z" }],
      totalFound: 1,
      status: "ok",
      errors: [],
    });

    const result = await enrichProcurement(baseInput);

    expect(result.status).toBe("success");
    expect(mockedCompranet).toHaveBeenCalled();
    expect(mockedSipot).toHaveBeenCalled();
    expect(mockedOcds).toHaveBeenCalled();
  });

  it("continúa sin antecedentes si todos los collectors fallan", async () => {
    const url = "https://example.com/bases.pdf";
    mockedCollect.mockResolvedValue(makeCollectorResult([{ title: "Bases", fileUrl: url }]));
    mockedDownload.mockResolvedValue(makeDownloadResults([url], ["ok"]));
    mockedParsePdf.mockResolvedValue({ text: "", parseStatus: "empty", errors: [] });
    mockedExtractBudget.mockReturnValue({ signals: [], hasSignals: false, highestAmount: null });
    mockedCompranet.mockRejectedValue(new Error("CompraNet caído"));
    mockedSipot.mockRejectedValue(new Error("SIPOT caído"));
    mockedOcds.mockRejectedValue(new Error("OCDS caído"));

    await expect(enrichProcurement(baseInput)).resolves.toBeDefined();
  });
```

- [ ] **Step 7: Verificar que los nuevos tests fallan**

```bash
npx jest src/jobs/__tests__/enrich-procurement.test.ts --no-coverage 2>&1 | grep "Tests:"
```

Expected: 2 tests failing (collectors no están en el job aún).

- [ ] **Step 8: Agregar imports en `enrich-procurement.job.ts`**

Después de los imports de parsers existentes, agregar:

```typescript
import { fetchCompranetHistorico } from "../collectors/compranet-historico/index";
import { fetchPntSipot } from "../collectors/pnt-sipot/index";
import { fetchContratacionesAbiertas } from "../collectors/contrataciones-abiertas/index";
```

- [ ] **Step 9: Agregar helper `extractKeywords` antes de `parseDocumentFile`**

```typescript
const STOPWORDS = new Set([
  "para", "con", "los", "las", "del", "que", "por", "una", "sus",
  "este", "esta", "como", "todo", "todos", "pero", "sino", "desde",
]);

function extractKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-záéíóúüñ\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
    .slice(0, 5);
}
```

- [ ] **Step 10: Agregar paso 5c en `enrichProcurement`**

Después del bloque de budget signal (paso 5b) y **antes** del `log.info("✅ enrichProcurement completado")`, insertar:

```typescript
    // 5c. Antecedentes en paralelo (Promise.allSettled — falla silenciosamente)
    const titleKeywords = extractKeywords(input.title ?? "");
    const [historicoSettled, sipotSettled, ocdsSettled] = await Promise.allSettled([
      fetchCompranetHistorico({ keywords: titleKeywords, scope: input.scope, yearFrom: 2020 }),
      fetchPntSipot({ keywords: titleKeywords, scope: input.scope }),
      fetchContratacionesAbiertas({ keywords: titleKeywords, scope: input.scope }),
    ]);

    const historicoContracts =
      historicoSettled.status === "fulfilled" ? historicoSettled.value.contracts : [];
    const sipotContracts =
      sipotSettled.status === "fulfilled" ? sipotSettled.value.contracts : [];
    const ocdsContracts =
      ocdsSettled.status === "fulfilled" ? ocdsSettled.value.contracts : [];

    const compranetAmounts = historicoContracts
      .map((c) => c.awardedAmount ?? 0)
      .filter((a) => a > 0);
    const compranetHighestAmount = compranetAmounts.length > 0
      ? Math.max(...compranetAmounts)
      : null;

    const antecedentes = {
      compranetCount: historicoContracts.length,
      compranetHighestAmount,
      sipotCount: sipotContracts.length,
      ocdsCount: ocdsContracts.length,
    };

    log.info(
      { jobId, compranetCount: antecedentes.compranetCount, sipotCount: antecedentes.sipotCount,
        ocdsCount: antecedentes.ocdsCount },
      "📊 Antecedentes encontrados",
    );
```

- [ ] **Step 11: Pasar `antecedentes` a `formatEnrichedAlert`**

En la llamada a `formatEnrichedAlert` (paso 6), agregar el campo:

```typescript
      antecedentes,
```

- [ ] **Step 12: Correr todos los tests**

```bash
npm test -- --no-coverage
```

Expected: ≥ 233 tests, 0 failing.

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

- [ ] **Step 15: Commit + push**

```bash
cd "/Users/kennethjts/Claude Code Ultraplan/Radar-Licitaciones-MX" && git add apps/worker/src/jobs/enrich-procurement.job.ts apps/worker/src/jobs/__tests__/enrich-procurement.test.ts apps/worker/src/alerts/telegram.alerts.ts apps/worker/src/alerts/__tests__/telegram.enriched.test.ts && git commit -m "feat: F5 — integrar antecedentes multi-fuente en enrich-procurement" && git push origin main
```

---

## Summary

| Tarea | Archivos nuevos | Tests nuevos |
|-------|----------------|--------------|
| F1 (compranet-historico) | 2 | 5 |
| F2 (pnt-sipot) | 2 | 5 |
| F3 (contrataciones-abiertas) | 2 | 5 |
| F4 (dof-sidof) | 2 | 5 |
| F5 (integration) | mods 4 archivos | +5 |
| **Total** | **8 nuevos** | **~25 nuevos** |

Total esperado post-Fase F: **≥ 232 tests**.

**Todos los collectors siguen las reglas:**
- `filterProcurementScope` aplicado antes de retornar
- Falla silenciosamente (`status: "unavailable"`, no throw)
- Rate limit skipped en `NODE_ENV=test`
- Timeouts configurados con constantes nombradas
