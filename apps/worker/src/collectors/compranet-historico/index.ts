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
