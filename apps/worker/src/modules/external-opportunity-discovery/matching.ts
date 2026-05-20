import { createHash } from "crypto";
import {
  findMatchingTerms,
  normalizeText,
  textContainsTerm,
} from "../../core/text";
import {
  CAPUFE_NATIONAL_OPPORTUNITY_TERMS,
  MORELOS_TERMS,
} from "./keywords";
import type {
  BusinessLineKeywordConfig,
  ExternalLead,
  ExternalLeadCandidate,
  ExternalLeadDiscardReason,
  ExternalLeadDiscardedCandidate,
  ExternalOpportunityType,
  PublicContactFields,
} from "./types";

const PUBLIC_OFFICIAL_HOSTS = [
  "gob.mx",
  "dof.gob.mx",
  "datos.gob.mx",
  "plataformadetransparencia.org.mx",
  "inai.org.mx",
  "comprasmx.buengobierno.gob.mx",
];

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const MX_PHONE_PATTERN =
  /(?:\+?52[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4}\b/g;
const TOKEN_PATTERN =
  /\b(?:bearer|token|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|signature|sig)\s*[:=]\s*[A-Za-z0-9._~+/=-]{8,}/gi;
const PERSONAL_NAME_PATTERN =
  /\b(?:c\.?|lic\.?|licenciado|licenciada|ing\.?|dr\.?|dra\.?|mtro\.?|mtra\.?)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3}/g;
const SENSITIVE_URL_PARAMS = new Set([
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "key",
  "secret",
  "signature",
  "sig",
  "code",
  "auth",
]);

const TARGET_LOCATION_TERMS = {
  morelos: MORELOS_TERMS,
  jalisco: [
    "jalisco",
    "guadalajara",
    "zapopan",
    "tlaquepaque",
    "san pedro tlaquepaque",
    "tonala",
    "tonalá",
    "tlajomulco",
    "tlajomulco de zuniga",
    "tlajomulco de zúñiga",
  ],
  cdmx: [
    "cdmx",
    "ciudad de mexico",
    "ciudad de méxico",
    "mexico city",
    "alcaldia",
    "alcaldía",
  ],
  estadoDeMexico: [
    "estado de mexico",
    "estado de méxico",
    "edomex",
    "edo mex",
    "toluca",
    "ecatepec",
    "naucalpan",
    "tlalnepantla",
    "nezahualcoyotl",
    "nezahualcóyotl",
  ],
} as const;

const TARGET_LOCATION_LABELS: Record<keyof typeof TARGET_LOCATION_TERMS, string> = {
  morelos: "Morelos",
  jalisco: "Jalisco OR Guadalajara",
  cdmx: "CDMX OR Ciudad de México",
  estadoDeMexico: "Estado de México OR Edomex",
};

type TargetLocationKey = keyof typeof TARGET_LOCATION_TERMS;

function targetLocationKeyFor(value: string): TargetLocationKey | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  for (const [key, terms] of Object.entries(TARGET_LOCATION_TERMS)) {
    if (terms.some((term) => normalizeText(term) === normalized)) {
      return key as TargetLocationKey;
    }
  }

  return null;
}

function targetLocationTerms(targetLocations?: string[]): string[] {
  if (!targetLocations || targetLocations.length === 0) return [];

  const terms = new Set<string>();
  for (const location of targetLocations) {
    const key = targetLocationKeyFor(location);
    const sourceTerms = key ? TARGET_LOCATION_TERMS[key] : [location];
    sourceTerms.forEach((term) => terms.add(term));
  }

  return [...terms];
}

export function buildTargetLocationQueryPrefix(targetLocations?: string[]): string {
  if (!targetLocations || targetLocations.length === 0) return "";

  const labels = new Set<string>();
  for (const location of targetLocations) {
    const key = targetLocationKeyFor(location);
    labels.add(key ? TARGET_LOCATION_LABELS[key] : location.trim());
  }

  return [...labels].filter(Boolean).join(" OR ");
}

export function findMatchedBusinessKeywords(
  text: string,
  config: BusinessLineKeywordConfig,
): string[] {
  return findMatchingTerms(text, config.keywords);
}

export function isAllowedOfficialSourceUrl(sourceUrl: string): boolean {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return PUBLIC_OFFICIAL_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}

export function canonicalizeExternalUrl(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    url.hash = "";
    url.username = "";
    url.password = "";

    const entries = [...url.searchParams.entries()]
      .filter(([key]) => {
        const normalizedKey = key.toLowerCase();
        return (
          !normalizedKey.startsWith("utm_") &&
          !SENSITIVE_URL_PARAMS.has(normalizedKey)
        );
      })
      .sort(([left], [right]) => left.localeCompare(right));

    url.search = "";
    for (const [key, value] of entries) {
      url.searchParams.append(key, value);
    }

    return url.toString();
  } catch {
    return sourceUrl.trim();
  }
}

export function sanitizePublicUrl(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null;

  try {
    const url = new URL(sourceUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
    }

    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_URL_PARAMS.has(key.toLowerCase())) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function inferOpportunityType(text: string): ExternalOpportunityType {
  const normalized = normalizeText(text);

  if (
    [
      "licitacion abierta",
      "convocatoria",
      "bases",
      "junta de aclaraciones",
      "presentacion de proposiciones",
      "presentación de proposiciones",
    ].some((term) => textContainsTerm(normalized, term))
  ) {
    return "licitacion";
  }

  if (
    [
      "proxima licitacion",
      "próxima licitación",
      "programa anual",
      "prebases",
      "proyecto de convocatoria",
    ].some((term) => textContainsTerm(normalized, term))
  ) {
    return "licitacion_proxima";
  }

  if (
    [
      "contrato",
      "adjudicacion",
      "adjudicación",
      "fallo",
      "proveedor adjudicado",
      "monto contratado",
    ].some((term) => textContainsTerm(normalized, term))
  ) {
    return "contrato_historico";
  }

  return "senal_comercial_publica";
}

export function detectMorelosScope(text: string): {
  state: string | null;
  municipality: string | null;
} {
  const matched = findMatchingTerms(text, MORELOS_TERMS);
  if (matched.length === 0) {
    return { state: null, municipality: null };
  }

  const municipality =
    matched.find((term) => normalizeText(term) !== "morelos" && !term.includes("estado")) ??
    null;

  return {
    state: "Morelos",
    municipality,
  };
}

export function isExternalLeadInAllowedScope(
  candidate: Pick<
    ExternalLeadCandidate,
    "state" | "municipality" | "evidenceText" | "title" | "organizationName" | "sourceUrl"
  >,
  morelosOnly: boolean,
  targetLocations?: string[],
): boolean {
  const text = [
    candidate.title,
    candidate.evidenceText,
    candidate.organizationName ?? "",
    candidate.state ?? "",
    candidate.municipality ?? "",
    candidate.sourceUrl ?? "",
  ].join(" ");

  const targetTerms = targetLocationTerms(targetLocations);
  if (targetTerms.length > 0) {
    return findMatchingTerms(text, targetTerms).length > 0;
  }

  const isMorelos =
    normalizeText(candidate.state ?? "") === "morelos" ||
    findMatchingTerms(text, MORELOS_TERMS).length > 0;

  if (isMorelos) return true;
  if (morelosOnly) return false;

  const mentionsCapufe = textContainsTerm(text, "capufe") ||
    textContainsTerm(text, "caminos y puentes federales");
  if (!mentionsCapufe) return true;

  return findMatchingTerms(text, CAPUFE_NATIONAL_OPPORTUNITY_TERMS).length > 0;
}

export function buildExternalLeadFingerprint(
  lead: Pick<
    ExternalLeadCandidate | ExternalLead,
    | "sourceUrl"
    | "organizationName"
    | "title"
    | "vertical"
    | "opportunityType"
    | "sourcePublishedAt"
  >,
): string {
  const optionalLead = lead as Partial<ExternalLeadCandidate>;
  const publicationDate = lead.sourcePublishedAt
    ? lead.sourcePublishedAt.slice(0, 10)
    : "";
  const payload = [
    normalizeText(optionalLead.sourceId ?? lead.sourceUrl),
    normalizeText(canonicalizeExternalUrl(optionalLead.canonicalUrl ?? lead.sourceUrl)),
    normalizeText(lead.organizationName ?? ""),
    normalizeText(lead.title),
    normalizeText(optionalLead.dependency ?? ""),
    publicationDate,
    optionalLead.amount ?? "",
    normalizeText(optionalLead.procedureId ?? ""),
    lead.vertical,
    lead.opportunityType,
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}

export function dedupeExternalLeadCandidates(
  candidates: ExternalLeadCandidate[],
): ExternalLeadCandidate[] {
  return dedupeExternalLeadCandidatesWithTelemetry(candidates).deduped;
}

export function dedupeExternalLeadCandidatesWithTelemetry(
  candidates: ExternalLeadCandidate[],
): {
  deduped: ExternalLeadCandidate[];
  discardedDuplicateCount: number;
  discardedDuplicates: ExternalLeadDiscardedCandidate[];
} {
  const seen = new Set<string>();
  const deduped: ExternalLeadCandidate[] = [];
  const discardedDuplicates: ExternalLeadDiscardedCandidate[] = [];

  for (const candidate of candidates) {
    const fingerprint = buildExternalLeadFingerprint(candidate);
    if (seen.has(fingerprint)) {
      discardedDuplicates.push(
        buildDiscardedCandidateSummary({
          ...candidate,
          reasons: ["deduplication"],
        }),
      );
      continue;
    }
    seen.add(fingerprint);
    deduped.push(candidate);
  }

  return {
    deduped,
    discardedDuplicateCount: discardedDuplicates.length,
    discardedDuplicates,
  };
}

export function buildDiscardedCandidateSummary(
  candidate: Pick<
    ExternalLeadCandidate,
    | "sourceName"
    | "sourceUrl"
    | "detectedAt"
    | "title"
    | "vertical"
    | "opportunityType"
    | "matchedKeywords"
    | "sourcePublishedAt"
  > & {
    reasons: ExternalLeadDiscardReason[];
    estimatedScore?: number | null;
    confidence?: ExternalLeadDiscardedCandidate["confidence"];
  },
): ExternalLeadDiscardedCandidate {
  return {
    sourceName: candidate.sourceName,
    sourceUrl: sanitizePublicUrl(candidate.sourceUrl) ?? "",
    publicUrl: sanitizePublicUrl(candidate.sourceUrl),
    detectedAt: candidate.detectedAt,
    title: redactSensitivePublicData(candidate.title),
    vertical: candidate.vertical,
    opportunityType: candidate.opportunityType,
    matchedKeywords: candidate.matchedKeywords.slice(0, 8),
    reasons: candidate.reasons,
    estimatedScore: candidate.estimatedScore ?? null,
    confidence: candidate.confidence ?? null,
    sourcePublishedAt: candidate.sourcePublishedAt,
  };
}

export function redactSensitivePublicData(text: string): string {
  return text
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(MX_PHONE_PATTERN, "[REDACTED_PHONE]")
    .replace(TOKEN_PATTERN, "[REDACTED_TOKEN]")
    .replace(PERSONAL_NAME_PATTERN, "[REDACTED_PERSON]");
}

export function sanitizePublicContact(
  candidate: Partial<PublicContactFields> & { sourceUrl: string },
): PublicContactFields {
  const contactArea = candidate.contactArea?.trim() || null;

  if (!isAllowedOfficialSourceUrl(candidate.sourceUrl) || !contactArea) {
    return {
      contactArea: null,
      contactNamePublicOptional: null,
      contactEmailPublicOptional: null,
      contactPhonePublicOptional: null,
    };
  }

  return {
    contactArea,
    contactNamePublicOptional: null,
    contactEmailPublicOptional: null,
    contactPhonePublicOptional: null,
  };
}
