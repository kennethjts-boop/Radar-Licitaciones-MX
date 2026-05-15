import axios from "axios";
import * as cheerio from "cheerio";
import { createModuleLogger } from "../../core/logger";
import { truncateForTelegram } from "../../core/text";
import { nowISO } from "../../core/time";
import {
  BUSINESS_LINE_KEYWORDS,
  CAPUFE_NATIONAL_OPPORTUNITY_TERMS,
} from "./keywords";
import {
  detectMorelosScope,
  findMatchedBusinessKeywords,
  inferOpportunityType,
  isAllowedOfficialSourceUrl,
  isExternalLeadInAllowedScope,
} from "./matching";
import type {
  BusinessLineKeywordConfig,
  ExternalLeadCandidate,
  ExternalLeadRunOptions,
  ExternalLeadSourceQueryResult,
} from "./types";

const log = createModuleLogger("external-leads-sources");

const DATOS_GOB_DATASET_SEARCH = "https://www.datos.gob.mx/dataset/";

interface DatosGobSearchItem {
  title?: string;
  url?: string;
  snippet?: string;
}

interface DatosGobQueryResult {
  candidates: ExternalLeadCandidate[];
  queryResult: ExternalLeadSourceQueryResult;
}

function buildHighSignalQueries(
  config: BusinessLineKeywordConfig,
  morelosOnly: boolean,
): string[] {
  const keywordSeeds = config.keywords.slice(0, 8);
  const signalSeeds = config.osintSignals.slice(0, 4);
  const geo = morelosOnly ? "Morelos " : "";

  const queries = [
    `${geo}${keywordSeeds.slice(0, 3).join(" OR ")} contrato`,
    `${geo}${signalSeeds.slice(0, 2).join(" ")} ${keywordSeeds[0]}`,
    `${geo}${config.displayName} licitacion contrato`,
  ];

  if (!morelosOnly) {
    queries.push(
      `CAPUFE ${CAPUFE_NATIONAL_OPPORTUNITY_TERMS.slice(0, 3).join(" ")} ${keywordSeeds[0]}`,
    );
  }

  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
}

function datosGobSearchUrl(query: string): string {
  const url = new URL(DATOS_GOB_DATASET_SEARCH);
  url.searchParams.set("q", query);
  return url.toString();
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function datosGobSourceUrl(href: string): string | null {
  try {
    const url = new URL(href, DATOS_GOB_DATASET_SEARCH);
    if (!url.hostname.endsWith("datos.gob.mx")) return null;
    if (!url.pathname.includes("/dataset/")) return null;
    if (url.pathname === "/dataset/" || url.pathname === "/dataset") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseDatosGobSearchItems(html: string): DatosGobSearchItem[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const items: DatosGobSearchItem[] = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const sourceUrl = datosGobSourceUrl(href);
    if (!sourceUrl || seen.has(sourceUrl)) return;

    const title = compactText($(element).text());
    if (!title || title.length < 4) return;

    const container = $(element).closest(
      ".dataset-item, .module-content, .media, article, li, div",
    );
    const snippet = compactText(container.text());
    seen.add(sourceUrl);
    items.push({
      title,
      url: sourceUrl,
      snippet: truncateForTelegram(snippet || title, 700),
    });
  });

  return items;
}

function itemEvidence(item: DatosGobSearchItem): string {
  return truncateForTelegram([item.title ?? "", item.snippet ?? ""].join(" "), 700);
}

function organizationTypeFromEvidence(evidence: string): string | null {
  const lower = evidence.toLowerCase();
  if (lower.includes("ayuntamiento") || lower.includes("municipio")) {
    return "municipio";
  }
  if (lower.includes("secretaria") || lower.includes("secretaría")) {
    return "dependencia estatal/federal";
  }
  if (lower.includes("organismo operador")) return "organismo publico";
  return null;
}

function buyerAreaFromEvidence(evidence: string): string | null {
  const areas = [
    "adquisiciones",
    "compras",
    "recursos materiales",
    "servicios generales",
    "administracion",
    "administración",
    "mantenimiento",
    "seguridad",
    "comunicacion social",
    "comunicación social",
  ];

  return areas.find((area) => evidence.toLowerCase().includes(area)) ?? null;
}

function amountVisibleInEvidence(evidence: string): boolean {
  return /\$?\s?\d{1,3}(,\d{3})+(\.\d{2})?|\b\d+(\.\d{2})?\s?(mxn|pesos)\b/i.test(
    evidence,
  );
}

function candidateFromDatosGobItem(
  item: DatosGobSearchItem,
  config: BusinessLineKeywordConfig,
  options: ExternalLeadRunOptions,
): ExternalLeadCandidate | null {
  const sourceUrl = item.url ?? null;
  if (!sourceUrl) return null;

  const evidence = itemEvidence(item);
  const matchedKeywords = findMatchedBusinessKeywords(evidence, config);
  if (matchedKeywords.length === 0) return null;

  const scope = detectMorelosScope(evidence);
  const title = item.title ?? config.displayName;
  const contactArea = buyerAreaFromEvidence(evidence);
  const candidate: ExternalLeadCandidate = {
    sourceName: "datos.gob.mx",
    sourceUrl,
    detectedAt: nowISO(),
    title,
    organizationName: null,
    organizationType: organizationTypeFromEvidence(evidence),
    state: scope.state,
    municipality: scope.municipality,
    sector: config.displayName,
    vertical: config.key,
    matchedKeywords,
    evidenceText: evidence,
    contactArea,
    contactNamePublicOptional: null,
    contactEmailPublicOptional: null,
    contactPhonePublicOptional: null,
    amountVisible: amountVisibleInEvidence(evidence),
    buyerAreaIdentified: contactArea !== null,
    opportunityType: inferOpportunityType(evidence),
    isOfficialSource: isAllowedOfficialSourceUrl(sourceUrl),
    sourcePublishedAt: null,
    raw: {
      datosGobSearchUrl: sourceUrl,
      referenceCompany: config.referenceCompany,
    },
  };

  if (!isExternalLeadInAllowedScope(candidate, options.morelosOnly)) {
    return null;
  }

  return candidate;
}

async function queryDatosGobMx(
  query: string,
  config: BusinessLineKeywordConfig,
  options: ExternalLeadRunOptions,
): Promise<DatosGobQueryResult> {
  const url = datosGobSearchUrl(query);

  try {
    const response = await axios.get<string>(url, {
      timeout: 12_000,
      headers: { "User-Agent": "Radar-Licitaciones-MX/1.0" },
      validateStatus: () => true,
    });

    const queryResult: ExternalLeadSourceQueryResult = {
      sourceName: "datos.gob.mx",
      query,
      url,
      httpStatus: response.status,
      ok: response.status >= 200 && response.status < 400,
      error: null,
    };

    if (!queryResult.ok) {
      queryResult.error = `HTTP ${response.status}`;
      return { candidates: [], queryResult };
    }

    const items = parseDatosGobSearchItems(response.data).slice(
      0,
      Math.min(options.maxResultsPerRun, 10),
    );
    const candidates = items
      .map((item) => candidateFromDatosGobItem(item, config, options))
      .filter((candidate): candidate is ExternalLeadCandidate => candidate !== null);

    return { candidates, queryResult };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      candidates: [],
      queryResult: {
        sourceName: "datos.gob.mx",
        query,
        url,
        httpStatus: null,
        ok: false,
        error: message,
      },
    };
  }
}

export async function discoverExternalLeadCandidates(
  options: ExternalLeadRunOptions,
): Promise<{
  candidates: ExternalLeadCandidate[];
  errors: string[];
  errorsBySource: Record<string, string[]>;
  sourcesReviewed: number;
  sourceQueries: ExternalLeadSourceQueryResult[];
}> {
  const candidates: ExternalLeadCandidate[] = [];
  const errors: string[] = [];
  const errorsBySource: Record<string, string[]> = {};
  const sourceQueries: ExternalLeadSourceQueryResult[] = [];
  let sourcesReviewed = 0;
  const maxPerVertical = Math.max(
    1,
    Math.ceil(options.maxResultsPerRun / BUSINESS_LINE_KEYWORDS.length),
  );

  for (const config of BUSINESS_LINE_KEYWORDS) {
    const queries = buildHighSignalQueries(config, options.morelosOnly).slice(0, 3);

    for (const query of queries) {
      if (candidates.length >= options.maxResultsPerRun) break;

      try {
        sourcesReviewed++;
        const found = await queryDatosGobMx(query, config, {
          ...options,
          maxResultsPerRun: maxPerVertical,
        });
        sourceQueries.push(found.queryResult);

        if (!found.queryResult.ok && found.queryResult.error) {
          errorsBySource["datos.gob.mx"] = [
            ...(errorsBySource["datos.gob.mx"] ?? []),
            `${config.key}: ${found.queryResult.error}`,
          ];
          log.warn(
            { query, vertical: config.key, error: found.queryResult.error },
            "Consulta OSINT externa sin resultados por error recuperable",
          );
          continue;
        }

        candidates.push(...found.candidates);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sourceQueries.push({
          sourceName: "datos.gob.mx",
          query,
          url: datosGobSearchUrl(query),
          httpStatus: null,
          ok: false,
          error: message,
        });
        errorsBySource["datos.gob.mx"] = [
          ...(errorsBySource["datos.gob.mx"] ?? []),
          `${config.key}: ${message}`,
        ];
        log.warn({ err, query, vertical: config.key }, "Fallo consulta OSINT externa");
      }
    }
  }

  return {
    candidates: candidates.slice(0, options.maxResultsPerRun),
    errors,
    errorsBySource,
    sourcesReviewed,
    sourceQueries,
  };
}

export const ALLOWED_EXTERNAL_SOURCE_FAMILIES = [
  "DOF",
  "Plataforma Nacional de Transparencia / SIPOT",
  "datos.gob.mx",
  "portales estatales y municipales de transparencia",
  "padrones publicos de proveedores y contratistas",
  "sitios oficiales de dependencias",
  "convocatorias publicas institucionales",
  "historicos de adjudicaciones, contratos y fallos",
];
