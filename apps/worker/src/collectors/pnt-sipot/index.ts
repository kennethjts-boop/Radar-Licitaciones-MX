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
  yearFrom?: number;
  yearTo?: number;
  maxResults?: number;
}

export interface SipotContract extends HistoricoContract {
  expedienteId: string | null;
  procedureType: string | null;
  contractNumber: string | null;
  procurementProcedureNumber: string | null;
  supplierRfc: string | null;
  amountMin: number | null;
  amountMax: number | null;
  signingDate: string | null;
  startDate: string | null;
  endDate: string | null;
  fiscalYear: number | null;
  institutionType: string | null;
  evidenceText: string;
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
  const cleaned = String(raw)
    .replace(/\s/g, "")
    .replace(/,/g, "")
    .replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function getField(record: Record<string, unknown>, ...keys: string[]): string | null {
  const normalizedEntries = new Map(
    Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]),
  );
  for (const k of keys) {
    const v = record[k] ?? normalizedEntries.get(k.toLowerCase());
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return null;
}

function buildSearchQuery(query: SipotQuery): string {
  return [...query.keywords, query.dependency ?? ""]
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term, index, arr) => arr.findIndex((t) => t.toLowerCase() === term.toLowerCase()) === index)
    .join(" ");
}

function isWithinYearRange(contract: SipotContract, query: SipotQuery): boolean {
  const year = contract.fiscalYear ?? contract.year;
  if (query.yearFrom !== undefined && year !== null && year < query.yearFrom) return false;
  if (query.yearTo !== undefined && year !== null && year > query.yearTo) return false;
  return true;
}

function mapSipotRecord(record: Record<string, unknown>): SipotContract {
  const contractNumber = getField(record, "numeroContrato", "numero_contrato", "contrato");
  const expedienteId = getField(record, "expediente", "idExpediente", "numeroExpediente");
  const procurementProcedureNumber = getField(
    record,
    "numeroProcedimiento",
    "numeroProcedimientoContratacion",
    "numeroExpediente",
    "procedimiento",
  );
  const title = getField(record, "objetoContrato", "descripcion", "concepto", "titulo", "objeto");
  const dependency = getField(record, "nombreSujetoObligado", "institucion", "dependencia", "sujetoObligado");
  const supplier = getField(record, "nombreContratista", "proveedor", "nombreComercial", "razonSocial");
  const signingDate = getField(record, "fechaContrato", "fechaCelebracion", "fechaFirma");
  const startDate = getField(record, "fechaInicio", "fechaInicioContrato", "fechaInicial");
  const endDate = getField(record, "fechaTermino", "fechaFin", "fechaConclusion", "fechaFinal");
  const amountMin = parseAmount(getField(record, "montoMinimo", "monto_minimo"));
  const amountMax = parseAmount(getField(record, "montoMaximo", "monto_maximo"));
  const awardedAmount =
    parseAmount(getField(record, "montoContrato", "montoTotal", "montoAdjudicado", "importeContrato")) ??
    amountMax ??
    amountMin;
  const fiscalYear = parseYear(getField(record, "ejercicio", "anio", "año", "periodo"));
  const year = fiscalYear ?? parseYear(signingDate ?? startDate);

  return {
    procedureNumber: procurementProcedureNumber ?? contractNumber ?? expedienteId,
    title,
    dependency,
    supplier,
    awardedAmount,
    currency: getField(record, "moneda") ?? "MXN",
    year,
    state: getField(record, "entidadFederativa", "estado"),
    contractType: getField(record, "tipoProcedimiento", "tipoContratacion"),
    sourceUrl: ENDPOINT_URL,
    retrievedAt: nowISO(),
    expedienteId,
    procedureType: getField(record, "tipoProcedimiento", "modalidad"),
    contractNumber,
    procurementProcedureNumber,
    supplierRfc: getField(record, "rfcContratista", "rfcProveedor", "rfc"),
    amountMin,
    amountMax,
    signingDate,
    startDate,
    endDate,
    fiscalYear,
    institutionType: getField(record, "tipoSujetoObligado", "ordenGobierno", "ambito"),
    evidenceText: [
      title,
      dependency,
      supplier,
      contractNumber,
      procurementProcedureNumber,
      awardedAmount !== null ? `monto ${awardedAmount}` : null,
      year !== null ? `año ${year}` : null,
    ]
      .filter(Boolean)
      .join(" | "),
  };
}

// ── Función principal ──────────────────────────────────────────────────────────

export async function fetchPntSipot(query: SipotQuery): Promise<SipotResult> {
  const maxResults = query.maxResults ?? 20;
  const searchQuery = buildSearchQuery(query);

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
    const records: Record<string, unknown>[] = Array.isArray(rawRecords)
      ? (rawRecords as Record<string, unknown>[])
      : [];

    if (process.env.NODE_ENV !== "test") {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }

    const mapped = records.map(mapSipotRecord).filter((c) => isWithinYearRange(c, query));
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
