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
    const records: Record<string, unknown>[] = Array.isArray(rawRecords)
      ? (rawRecords as Record<string, unknown>[])
      : [];

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
