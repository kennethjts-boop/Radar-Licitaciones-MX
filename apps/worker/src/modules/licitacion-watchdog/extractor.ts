import type { Page } from "playwright";
import { BrowserManager } from "../../collectors/comprasmx/browser.manager";
import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import type {
  JsonObject,
  VisibleTableSnapshot,
  WatchdogDocument,
  WatchdogSnapshot,
} from "./types";
import {
  documentContentSignature,
  normalizeSnapshot,
  tableContentSignatures,
} from "./snapshot";

const log = createModuleLogger("licitacion-watchdog:extractor");
const API_ORIGIN = "https://upcp-cnetservicios.buengobierno.gob.mx";
const DETAIL_TIMEOUT_MS = 90_000;
const DOM_STABILITY_POLL_MS = 500;
const DOM_STABILITY_TIMEOUT_MS = 15_000;

interface ComprasMxEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
  details?: string;
}

interface AnexoDocument {
  uuid_pa?: string;
  nombre?: string;
  descripcion?: string;
  pa_fecha_creacion?: string;
  pa_fecha_modificacion?: string;
  original_size?: number;
}

interface AnexoGroup {
  descripcion?: string;
  tipodoc_descripcion?: string;
  documentos?: AnexoDocument[];
}

interface AnexosPage {
  registros?: AnexoGroup[];
  paginacion?: Array<{
    pagina_actual?: number;
    total_paginas?: number;
  }>;
}

function assertSuccessful<T>(payload: ComprasMxEnvelope<T>, label: string): T {
  if (payload.success === false || payload.data === undefined) {
    throw new Error(`${label}: ${payload.details ?? payload.error ?? "respuesta sin data"}`);
  }
  return payload.data;
}

function documentUrl(id: string): string {
  return `${API_ORIGIN}/norah/documentos/recursos/ulck?id_documento=${encodeURIComponent(id)}&user=sitiopublico`;
}

function buildDocuments(groups: AnexoGroup[]): WatchdogDocument[] {
  return groups.flatMap((group) => (group.documentos ?? []).map((document) => {
    const id = document.uuid_pa ?? "";
    const text = `${group.tipodoc_descripcion ?? ""} ${group.descripcion ?? ""} ${document.nombre ?? ""}`;
    return {
      id,
      name: document.nombre ?? group.descripcion ?? "Documento sin nombre",
      description: document.descripcion ?? group.descripcion ?? null,
      type: group.tipodoc_descripcion ?? null,
      createdAt: document.pa_fecha_creacion ?? null,
      modifiedAt: document.pa_fecha_modificacion ?? null,
      sizeBytes: typeof document.original_size === "number" ? document.original_size : null,
      url: id ? documentUrl(id) : "",
      isActa: /acta|junta de aclaraciones|fallo|apertura/i.test(text),
    };
  })).filter((document) => Boolean(document.id)).sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchAllAnnexGroups(
  page: Page,
  firstResponse: Awaited<ReturnType<Page["waitForResponse"]>>,
  firstPages: AnexosPage[],
): Promise<AnexoGroup[]> {
  const groups = [...(firstPages[0]?.registros ?? [])];
  const totalPages = firstPages[0]?.paginacion?.[0]?.total_paginas ?? 1;
  if (totalPages <= 1) return groups;

  const headers = await firstResponse.request().allHeaders();
  delete headers.host;
  delete headers["content-length"];
  for (let pageNumber = 2; pageNumber <= totalPages; pageNumber++) {
    const url = new URL(firstResponse.url());
    url.searchParams.set("page", String(pageNumber));
    const response = await page.context().request.get(url.toString(), { headers });
    if (!response.ok()) {
      throw new Error(`anexos ComprasMX página ${pageNumber}: HTTP ${response.status()}`);
    }
    const envelope = await response.json() as ComprasMxEnvelope<AnexosPage[]>;
    const pages = assertSuccessful(envelope, `anexos ComprasMX página ${pageNumber}`);
    groups.push(...(pages[0]?.registros ?? []));
  }
  return groups;
}

async function extractVisibleSnapshot(page: Page): Promise<{
  fields: JsonObject;
  tables: VisibleTableSnapshot[];
}> {
  return page.evaluate(() => {
    // Playwright serializa esta función al navegador; el tsconfig del worker no incluye DOM.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (globalThis as any).document;
    const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
    const labelNodes = Array.from(doc.querySelectorAll("label")) as Array<{ textContent: string | null }>;
    const fields: Record<string, string | string[]> = {};
    const isFieldName = (value: string) => value.endsWith(":") || value.startsWith("¿");

    for (let index = 0; index < labelNodes.length; index++) {
      const key = clean(labelNodes[index].textContent).replace(/:$/, "");
      if (!key || !isFieldName(clean(labelNodes[index].textContent))) continue;
      const next = labelNodes[index + 1];
      const value = clean(next?.textContent);
      if (!value || isFieldName(value)) continue;
      const existing = fields[key];
      if (existing === undefined) fields[key] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else fields[key] = [existing, value];
    }

    const tables = (Array.from(doc.querySelectorAll("table")) as Array<{
      querySelectorAll: (selector: string) => ArrayLike<unknown>;
    }>).map((table) => ({
      headers: (Array.from(table.querySelectorAll("th")) as Array<{ textContent: string | null }>).map((cell) => clean(cell.textContent)),
      rows: (Array.from(table.querySelectorAll("tbody tr")) as Array<{
        querySelectorAll: (selector: string) => ArrayLike<unknown>;
      }>).map((row) =>
        (Array.from(row.querySelectorAll("td")) as Array<{ textContent: string | null }>).map((cell) => clean(cell.textContent)),
      ),
    })).filter((table) => table.headers.length > 0 || table.rows.length > 0);

    return { fields, tables };
  }) as Promise<{ fields: JsonObject; tables: VisibleTableSnapshot[] }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface VisibleSnapshotStabilityOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export async function waitForStableVisibleSnapshot(
  page: Page,
  options: VisibleSnapshotStabilityOptions = {},
): Promise<{
  fields: JsonObject;
  tables: VisibleTableSnapshot[];
  partial: boolean;
}> {
  const pollIntervalMs = options.pollIntervalMs ?? DOM_STABILITY_POLL_MS;
  const timeoutMs = options.timeoutMs ?? DOM_STABILITY_TIMEOUT_MS;
  const maxPolls = Math.max(2, Math.ceil(timeoutMs / pollIntervalMs) + 1);
  let previousSignatures: string[] | null = null;
  let lastVisible: { fields: JsonObject; tables: VisibleTableSnapshot[] } = {
    fields: {},
    tables: [],
  };

  for (let poll = 0; poll < maxPolls; poll++) {
    lastVisible = await extractVisibleSnapshot(page);
    const signatures = tableContentSignatures(lastVisible.tables);
    const sameAsPrevious = previousSignatures !== null &&
      signatures.length === previousSignatures.length &&
      signatures.every((signature, index) => signature === previousSignatures?.[index]);
    const hasIncompleteTable = lastVisible.tables.length === 0 ||
      lastVisible.tables.some((table) => table.headers.length > 0 && table.rows.length === 0);

    if (sameAsPrevious && !hasIncompleteTable) {
      return { ...lastVisible, partial: false };
    }

    previousSignatures = signatures;
    if (poll < maxPolls - 1) await sleep(pollIntervalMs);
  }

  return { ...lastVisible, partial: true };
}

export async function extractWatchdogSnapshot(input: {
  numeroProcedimiento: string;
  expedienteUrl: string;
  uuidProcedimiento: string;
}): Promise<WatchdogSnapshot> {
  return BrowserManager.withContext(async (page) => {
    const detailPath = `/whitney/sitiopublico/expedientes/${input.uuidProcedimiento}`;
    const detailResponsePromise = page.waitForResponse((response) => {
      const parsed = new URL(response.url());
      return parsed.pathname === detailPath && parsed.searchParams.get("id_proceso") === "procedimiento";
    }, { timeout: DETAIL_TIMEOUT_MS });
    const annexResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`${detailPath}/anexos`),
    { timeout: DETAIL_TIMEOUT_MS });

    await page.goto(input.expedienteUrl, {
      waitUntil: "domcontentloaded",
      timeout: DETAIL_TIMEOUT_MS,
    });

    const [detailResponse, annexResponse] = await Promise.all([
      detailResponsePromise,
      annexResponsePromise,
    ]);
    const detailEnvelope = await detailResponse.json() as ComprasMxEnvelope<JsonObject>;
    const annexEnvelope = await annexResponse.json() as ComprasMxEnvelope<AnexosPage[]>;
    const detail = assertSuccessful(detailEnvelope, "detalle ComprasMX");
    const annexPages = assertSuccessful(annexEnvelope, "anexos ComprasMX");

    const visible = await waitForStableVisibleSnapshot(page);
    const annexGroups = await fetchAllAnnexGroups(page, annexResponse, annexPages);
    const documents = buildDocuments(annexGroups);
    const deploymentSha = getConfig().RAILWAY_GIT_COMMIT_SHA ?? null;
    const snapshotWithoutSignatures = normalizeSnapshot({
      partial: visible.partial,
      deploymentSha,
      tableSignatures: [],
      documentSignature: "",
      numeroProcedimiento: input.numeroProcedimiento,
      expedienteUrl: input.expedienteUrl,
      uuidProcedimiento: input.uuidProcedimiento,
      detail,
      documents,
      visibleFields: visible.fields,
      visibleTables: visible.tables,
    });
    const snapshot = normalizeSnapshot({
      ...snapshotWithoutSignatures,
      tableSignatures: tableContentSignatures(snapshotWithoutSignatures.visibleTables),
      documentSignature: documentContentSignature(snapshotWithoutSignatures.documents),
    });

    if (snapshot.partial) {
      log.warn(
        {
          numeroProcedimiento: input.numeroProcedimiento,
          deploymentSha,
          rowCounts: snapshot.visibleTables.map((table) => table.rows.length),
        },
        "Snapshot parcial de ComprasMX descartable: DOM no hidrató tablas en 15s",
      );
    } else {
      log.info(
        { numeroProcedimiento: input.numeroProcedimiento, deploymentSha, documents: documents.length },
        "Snapshot completo y estable de ComprasMX extraído",
      );
    }
    return snapshot;
  }, { timeoutMs: DETAIL_TIMEOUT_MS + 30_000 });
}
