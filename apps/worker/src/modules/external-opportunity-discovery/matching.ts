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

const PERSONAL_EMAIL_DOMAINS = [
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
];

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
    "sourceUrl" | "organizationName" | "title" | "vertical" | "opportunityType"
  >,
): string {
  const payload = [
    normalizeText(lead.sourceUrl),
    normalizeText(lead.organizationName ?? ""),
    normalizeText(lead.title),
    lead.vertical,
    lead.opportunityType,
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}

export function dedupeExternalLeadCandidates(
  candidates: ExternalLeadCandidate[],
): ExternalLeadCandidate[] {
  const seen = new Set<string>();
  const deduped: ExternalLeadCandidate[] = [];

  for (const candidate of candidates) {
    const fingerprint = buildExternalLeadFingerprint(candidate);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    deduped.push(candidate);
  }

  return deduped;
}

function isInstitutionalEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  if (PERSONAL_EMAIL_DOMAINS.includes(domain)) return false;
  return domain.endsWith(".gob.mx") || domain.endsWith(".edu.mx");
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

  const email = candidate.contactEmailPublicOptional?.trim() ?? null;
  const safeEmail = email && isInstitutionalEmail(email) ? email : null;

  return {
    contactArea,
    contactNamePublicOptional:
      contactArea && candidate.contactNamePublicOptional
        ? candidate.contactNamePublicOptional.trim()
        : null,
    contactEmailPublicOptional: safeEmail,
    contactPhonePublicOptional: candidate.contactPhonePublicOptional?.trim() || null,
  };
}
