import type { Page, Response } from "playwright";
import { BrowserManager } from "../../collectors/comprasmx/browser.manager";
import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import {
  preflightResilientWait,
  waitForResponseResilient,
  type ResilientWaitSkipped,
} from "../resilience/resilient-wait";
import {
  FastTimeoutError,
  FastWaitAbortedError,
  UpstreamError,
} from "../resilience/fast-wait";
import type {
  JsonObject,
  VisibleTableSnapshot,
  WatchdogDocument,
  WatchdogExtractionFailure,
  WatchdogExtractionResult,
  WatchdogFailureCause,
  WatchdogSkippedResult,
  WatchdogSnapshot,
} from "./types";
import {
  documentContentSignature,
  normalizeSnapshot,
  tableContentSignatures,
} from "./snapshot";

const log = createModuleLogger("licitacion-watchdog:extractor");
const API_ORIGIN = "https://upcp-cnetservicios.buengobierno.gob.mx";
const GOTO_TIMEOUT_MS = 45_000;
const GOTO_RETRY_BACKOFF_MS = 5_000;
const DATA_CONTAINER_TIMEOUT_MS = 20_000;
const DETAIL_DATA_SELECTOR = "app-sitiopublico-detalle-content .card label";
const DOM_STABILITY_POLL_MS = 500;
const DOM_STABILITY_TIMEOUT_MS = 15_000;
const ANNEX_PAGE_TIMEOUT_MS = 20_000;
const ANNEX_PAGINATOR_NEXT_SELECTOR =
  "app-sitiopublico-detalle-anexos .p-paginator-next:not(.p-disabled)";

class WatchdogWaitSkippedError extends Error {
  constructor(readonly skipped: ResilientWaitSkipped) {
    super(`Espera watchdog omitida para ${skipped.key}`);
    this.name = "WatchdogWaitSkippedError";
  }
}

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
  firstResponse: Response,
  firstPages: AnexosPage[],
): Promise<AnexoGroup[]> {
  const groups = [...(firstPages[0]?.registros ?? [])];
  const totalPages = firstPages[0]?.paginacion?.[0]?.total_paginas ?? 1;
  if (totalPages <= 1) return groups;

  // La API firma cada petición con headers anti-replay (grc/xgrc) que genera un
  // interceptor de la propia app Angular; replicar la petición fuera del navegador
  // devuelve HTTP 401. Las páginas siguientes se obtienen accionando el paginador
  // real de anexos y capturando la respuesta que emite la aplicación.
  const annexPathname = new URL(firstResponse.url()).pathname;
  for (let pageNumber = 2; pageNumber <= totalPages; pageNumber++) {
    const preflight = preflightResilientWait(annexPathname);
    if (preflight) throw new WatchdogWaitSkippedError(preflight);
    const waitAbortController = new AbortController();
    const responsePromise = waitForResponseResilient(
      page,
      annexPathname,
      (response) => {
        const parsed = new URL(response.url());
        return parsed.pathname === annexPathname &&
          parsed.searchParams.get("page") === String(pageNumber);
      },
      {
        timeoutMs: ANNEX_PAGE_TIMEOUT_MS,
        signal: waitAbortController.signal,
      },
    );
    void responsePromise.catch(() => undefined);
    try {
      await page.locator(ANNEX_PAGINATOR_NEXT_SELECTOR).first()
        .click({ timeout: ANNEX_PAGE_TIMEOUT_MS });
    } catch (error) {
      waitAbortController.abort();
      await Promise.allSettled([responsePromise]);
      throw error;
    }
    const waitResult = await responsePromise;
    if (waitResult.status === "skipped") {
      throw new WatchdogWaitSkippedError(waitResult);
    }
    const response = waitResult.response;
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

export function watchdogErrorMessage(error: unknown): string {
  if (error instanceof UpstreamError) {
    return `Upstream respondió HTTP ${error.status}: ${error.url}`;
  }
  if (error instanceof Error) return error.message || "Error sin mensaje";
  if (typeof error === "string") return error || "String vacío lanzado como error";
  return "Valor no Error lanzado sin mensaje seguro";
}

export function watchdogErrorType(error: unknown): string {
  if (error instanceof Error) return error.name?.trim() || "Error";
  return typeof error === "string" ? "StringThrown" : "NonErrorThrown";
}

export function classifyWatchdogFailure(error: unknown): WatchdogFailureCause {
  if (
    error instanceof FastTimeoutError ||
    error instanceof UpstreamError ||
    error instanceof FastWaitAbortedError
  ) {
    return "NETWORK_INFRA";
  }
  if (watchdogErrorType(error) === "DomStabilityError") {
    return "SITE_STRUCTURE";
  }

  const message = watchdogErrorMessage(error);
  const httpStatus = Number(message.match(/HTTP (\d{3})/)?.[1]);
  if (Number.isFinite(httpStatus)) {
    // 5xx y saturación son infraestructura del sitio; el resto de 4xx implica que
    // cambió el contrato del sitio (auth, rutas, firma de peticiones).
    return httpStatus >= 500 || httpStatus === 408 || httpStatus === 429
      ? "NETWORK_INFRA"
      : "SITE_STRUCTURE";
  }
  if (
    /net::ERR_ABORTED|timeout|timed out|Target page, context or browser has been closed|zygote|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket|network|fetch failed|browserType\.launch/i.test(message)
  ) {
    return "NETWORK_INFRA";
  }
  if (
    /selector|container|DOM|hydrate|table|paginator|Unauthorized|Acceso no permitido|respuesta sin data/i.test(message)
  ) {
    return "SITE_STRUCTURE";
  }
  return "APPLICATION_ERROR";
}

function isRetryableNavigationError(error: unknown): boolean {
  return /net::ERR_ABORTED|timeout|timed out/i.test(watchdogErrorMessage(error));
}

export interface NavigationResult {
  ok: boolean;
  attempts: number;
  error: unknown | null;
}

export async function navigateWatchdogPage(
  page: Page,
  url: string,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<NavigationResult> {
  let lastError: unknown = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    attempts = attempt;
    try {
      await page.goto(url, { waitUntil: "commit", timeout: GOTO_TIMEOUT_MS });
      return { ok: true, attempts: attempt, error: null };
    } catch (error) {
      lastError = error;
      log.warn(
        { err: error, attempt, url },
        "Navegación watchdog falló de forma contenida",
      );
      if (attempt === 2 || !isRetryableNavigationError(error)) break;
      await wait(GOTO_RETRY_BACKOFF_MS);
    }
  }
  return { ok: false, attempts, error: lastError };
}

function deploymentSha(): string | null {
  try {
    return getConfig().RAILWAY_GIT_COMMIT_SHA ?? null;
  } catch {
    return null;
  }
}

function buildSnapshot(input: {
  numeroProcedimiento: string;
  expedienteUrl: string;
  uuidProcedimiento: string;
}, data: {
  partial: boolean;
  extractionFailure: WatchdogExtractionFailure | null;
  detail?: JsonObject;
  documents?: WatchdogDocument[];
  visibleFields?: JsonObject;
  visibleTables?: VisibleTableSnapshot[];
}): WatchdogSnapshot {
  const snapshotWithoutSignatures = normalizeSnapshot({
    partial: data.partial,
    extractionFailure: data.extractionFailure,
    deploymentSha: deploymentSha(),
    tableSignatures: [],
    documentSignature: "",
    numeroProcedimiento: input.numeroProcedimiento,
    expedienteUrl: input.expedienteUrl,
    uuidProcedimiento: input.uuidProcedimiento,
    detail: data.detail ?? {},
    documents: data.documents ?? [],
    visibleFields: data.visibleFields ?? {},
    visibleTables: data.visibleTables ?? [],
  });
  return normalizeSnapshot({
    ...snapshotWithoutSignatures,
    tableSignatures: tableContentSignatures(snapshotWithoutSignatures.visibleTables),
    documentSignature: documentContentSignature(snapshotWithoutSignatures.documents),
  });
}

function partialSnapshot(
  input: {
    numeroProcedimiento: string;
    expedienteUrl: string;
    uuidProcedimiento: string;
  },
  failure: WatchdogExtractionFailure,
  visible?: { fields: JsonObject; tables: VisibleTableSnapshot[] },
): WatchdogSnapshot {
  log.warn(
    { numeroProcedimiento: input.numeroProcedimiento, failure },
    "Snapshot parcial del watchdog; no se comparará ni persistirá",
  );
  return buildSnapshot(input, {
    partial: true,
    extractionFailure: failure,
    visibleFields: visible?.fields,
    visibleTables: visible?.tables,
  });
}

function skippedResult(skipped: ResilientWaitSkipped): WatchdogSkippedResult {
  log.info(
    {
      endpointKey: skipped.key,
      reason: skipped.reason,
      msUntilRetry: skipped.msUntilRetry,
    },
    "[CIRCUIT] Ciclo watchdog omitido antes de golpear el endpoint",
  );
  return {
    status: "skipped",
    reason: skipped.reason,
    endpointKey: skipped.key,
    msUntilRetry: skipped.msUntilRetry,
  };
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
}): Promise<WatchdogExtractionResult> {
  const detailPath = `/whitney/sitiopublico/expedientes/${input.uuidProcedimiento}`;
  const annexPath = `${detailPath}/anexos`;
  const preflight = preflightResilientWait(detailPath) ??
    preflightResilientWait(annexPath);
  if (preflight) return skippedResult(preflight);

  try {
    // Los timeouts explícitos por etapa se complementan con un techo exterior
    // configurable que contiene cualquier espera inesperada del contexto.
    return await BrowserManager.withContext(async (page) => {
      const waitAbortController = new AbortController();
      const detailResponsePromise = waitForResponseResilient(
        page,
        detailPath,
        (response) => {
          const parsed = new URL(response.url());
          return parsed.pathname === detailPath &&
            parsed.searchParams.get("id_proceso") === "procedimiento";
        },
        { signal: waitAbortController.signal },
      );
      const annexResponsePromise = waitForResponseResilient(
        page,
        annexPath,
        (response) => response.url().includes(annexPath),
        { signal: waitAbortController.signal },
      );

      // Registrar handlers inmediatamente: aunque goto falle, ningún waiter podrá
      // convertirse después en un unhandledRejection al cerrar el contexto.
      void detailResponsePromise.catch(() => undefined);
      void annexResponsePromise.catch(() => undefined);

      const navigation = await navigateWatchdogPage(page, input.expedienteUrl);
      if (!navigation.ok) {
        waitAbortController.abort();
        await page.close().catch((error) => {
          log.warn({ err: error }, "No se pudo cerrar page tras fallo de navegación watchdog");
        });
        await Promise.allSettled([detailResponsePromise, annexResponsePromise]);
        return partialSnapshot(input, {
          cause: classifyWatchdogFailure(navigation.error),
          stage: "navigation",
          errorType: watchdogErrorType(navigation.error),
          message: watchdogErrorMessage(navigation.error),
          attempts: navigation.attempts,
        });
      }

      let containerError: unknown = null;
      try {
        await page.waitForSelector(DETAIL_DATA_SELECTOR, { timeout: DATA_CONTAINER_TIMEOUT_MS });
      } catch (error) {
        containerError = error;
        log.warn(
          { err: error, selector: DETAIL_DATA_SELECTOR },
          "Contenedor real de datos no apareció dentro del timeout",
        );
      }

      const [detailResult, annexResult] = await Promise.allSettled([
        detailResponsePromise,
        annexResponsePromise,
      ]);
      if (detailResult.status === "rejected" || annexResult.status === "rejected") {
        const failure = detailResult.status === "rejected"
          ? detailResult.reason
          : annexResult.status === "rejected"
            ? annexResult.reason
            : new Error("Respuesta API watchdog incompleta");
        return partialSnapshot(input, {
          cause: classifyWatchdogFailure(failure),
          stage: "api_responses",
          errorType: watchdogErrorType(failure),
          message: watchdogErrorMessage(failure),
          attempts: navigation.attempts,
        });
      }
      if (detailResult.value.status === "skipped") {
        return skippedResult(detailResult.value);
      }
      if (annexResult.value.status === "skipped") {
        return skippedResult(annexResult.value);
      }

      const detailEnvelope = await detailResult.value.response.json() as ComprasMxEnvelope<JsonObject>;
      const annexEnvelope = await annexResult.value.response.json() as ComprasMxEnvelope<AnexosPage[]>;
      const detail = assertSuccessful(detailEnvelope, "detalle ComprasMX");
      const annexPages = assertSuccessful(annexEnvelope, "anexos ComprasMX");
      const visible = await waitForStableVisibleSnapshot(page);
      let annexGroups: AnexoGroup[];
      try {
        annexGroups = await fetchAllAnnexGroups(page, annexResult.value.response, annexPages);
      } catch (error) {
        if (error instanceof WatchdogWaitSkippedError) {
          return skippedResult(error.skipped);
        }
        return partialSnapshot(input, {
          cause: classifyWatchdogFailure(error),
          stage: "annex_pagination",
          errorType: watchdogErrorType(error),
          message: watchdogErrorMessage(error),
          attempts: navigation.attempts,
        }, visible);
      }
      const documents = buildDocuments(annexGroups);

      const extractionFailure: WatchdogExtractionFailure | null = containerError
        ? {
            cause: "SITE_STRUCTURE",
            stage: "data_container",
            errorType: watchdogErrorType(containerError),
            message: watchdogErrorMessage(containerError),
            attempts: navigation.attempts,
          }
        : visible.partial
          ? {
              cause: "SITE_STRUCTURE",
              stage: "dom_stability",
              errorType: "DomStabilityError",
              message: "DOM no hidrató tablas estables dentro de 15s",
              attempts: navigation.attempts,
            }
          : null;
      const snapshot = buildSnapshot(input, {
        partial: extractionFailure !== null,
        extractionFailure,
        detail,
        documents,
        visibleFields: visible.fields,
        visibleTables: visible.tables,
      });

      if (snapshot.partial) {
        log.warn(
          {
            numeroProcedimiento: input.numeroProcedimiento,
            deploymentSha: snapshot.deploymentSha,
            rowCounts: snapshot.visibleTables.map((table) => table.rows.length),
            extractionFailure,
          },
          "Snapshot parcial de ComprasMX descartable",
        );
      } else {
        log.info(
          {
            numeroProcedimiento: input.numeroProcedimiento,
            deploymentSha: snapshot.deploymentSha,
            documents: documents.length,
          },
          "Snapshot completo y estable de ComprasMX extraído",
        );
      }
      return snapshot;
    }, { timeoutMs: getConfig().WATCHDOG_CONTEXT_TIMEOUT_MS });
  } catch (error) {
    return partialSnapshot(input, {
      cause: classifyWatchdogFailure(error),
      stage: "browser_session",
      errorType: watchdogErrorType(error),
      message: watchdogErrorMessage(error),
      attempts: 1,
    });
  }
}
