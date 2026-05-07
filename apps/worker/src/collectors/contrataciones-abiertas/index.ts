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

// ── Função principal ──────────────────────────────────────────────────────────

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
