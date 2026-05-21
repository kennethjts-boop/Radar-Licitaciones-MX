import axios from "axios";
import * as cheerio from "cheerio";
import { findMatchingTerms, truncateForTelegram } from "../../core/text";
import { nowISO } from "../../core/time";
import {
  COMMERCIAL_PROFILES,
  commercialTerritoryAliases,
  detectCommercialTerritory,
  type CommercialProfile,
} from "../commercial-profiles";
import { matchCommercialOpportunity } from "../commercial-matching";
import {
  buildExternalLeadFingerprint,
  canonicalizeExternalUrl,
  inferOpportunityType,
  isAllowedOfficialSourceUrl,
  redactSensitivePublicData,
  sanitizePublicUrl,
} from "./matching";
import type {
  ExternalLeadEvidence,
  ExternalLeadRunOptions,
  ExternalLeadVertical,
  ExternalSourceType,
  NormalizedExternalLead,
  RawExternalItem,
  SanitizedExternalLead,
  ScoredExternalLead,
  SourceAdapter,
} from "./types";

const USER_AGENT = "Radar-Licitaciones-MX/2.0 ExternalOSINT";
const DATOS_GOB_DATASET_SEARCH = "https://www.datos.gob.mx/dataset/";
const DOF_SEARCH = "https://www.dof.gob.mx/busqueda_detalle.php";

interface HtmlLinkItem {
  title: string;
  url: string;
  snippet: string;
}

interface OfficialWebsiteConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

interface RssConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

interface AdapterDescriptor {
  sourceId: string;
  sourceName: string;
  sourceType: ExternalSourceType;
  query: string;
  url: string;
  profile: CommercialProfile;
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sourceUrlFromHref(href: string, baseUrl: string, hostSuffix?: string): string | null {
  try {
    const url = new URL(href, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (hostSuffix && !url.hostname.toLowerCase().endsWith(hostSuffix)) return null;
    return sanitizePublicUrl(url.toString());
  } catch {
    return null;
  }
}

export function isUnwantedTitle(title: string): boolean {
  const norm = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
  const unwanted = [
    "continuarleyendo",
    "leermas",
    "vermas",
    "masinformacion",
    "seguirleyendo",
  ];
  return unwanted.includes(norm);
}

function extractBetterTitle(
  $: any,
  element: any,
  container: any,
  href: string,
): string | null {
  // 1. Try other links in the container with the same href but valid text
  let bestLinkText: string | null = null;
  container.find("a[href]").each((_: any, el: any): any => {
    const elHref = $(el).attr("href") ?? "";
    if (elHref && elHref.includes(href)) {
      const text = ($(el).text() || "").trim();
      if (text && !isUnwantedTitle(text) && text.length >= 4) {
        bestLinkText = text;
        return false; // break
      }
    }
    return true;
  });
  if (bestLinkText) return bestLinkText;

  // 2. Try h1, h2, h3, h4, h5, h6 in the card container
  for (const h of ["h1", "h2", "h3", "h4", "h5", "h6", ".title", ".heading", ".card-title"]) {
    const heading = container.find(h).first();
    if (heading.length > 0) {
      const text = heading.text().trim();
      if (text && !isUnwantedTitle(text) && text.length >= 4) {
        return text;
      }
    }
  }

  // 3. Try to get title or aria-label of the element itself
  const ariaLabel = $(element).attr("aria-label");
  if (ariaLabel && !isUnwantedTitle(ariaLabel) && ariaLabel.trim().length >= 4) {
    return ariaLabel.trim();
  }

  const titleAttr = $(element).attr("title");
  if (titleAttr && !isUnwantedTitle(titleAttr) && titleAttr.trim().length >= 4) {
    return titleAttr.trim();
  }

  // 4. Try og:title in meta tags of the page
  const ogTitle = $('meta[property="og:title"]').attr("content");
  if (ogTitle && !isUnwantedTitle(ogTitle) && ogTitle.trim().length >= 4) {
    return ogTitle.trim();
  }

  // 5. Try twitter:title in meta tags of the page
  const twitterTitle = $('meta[name="twitter:title"]').attr("content");
  if (twitterTitle && !isUnwantedTitle(twitterTitle) && twitterTitle.trim().length >= 4) {
    return twitterTitle.trim();
  }

  // 6. Try h1 on the page (if it's a detail page)
  const mainH1 = $("h1").first().text().trim();
  if (mainH1 && !isUnwantedTitle(mainH1) && mainH1.length >= 4) {
    return mainH1;
  }

  // 7. Try title of the page
  const pageTitle = $("title").first().text().trim();
  if (pageTitle && !isUnwantedTitle(pageTitle) && pageTitle.length >= 4) {
    return pageTitle;
  }

  // 8. Try JSON-LD headline
  let jsonLdHeadline: string | null = null;
  $('script[type="application/ld+json"]').each((_: any, el: any): any => {
    try {
      const data = JSON.parse($(el).text() || "{}");
      const headline = data.headline || data.name;
      if (headline && typeof headline === "string" && !isUnwantedTitle(headline) && headline.trim().length >= 4) {
        jsonLdHeadline = headline.trim();
        return false; // break
      }
    } catch {
      // ignore JSON parse error
    }
    return true;
  });
  if (jsonLdHeadline) return jsonLdHeadline;

  // 9. Try main text of the card
  const containerText = container.text().trim();
  if (containerText) {
    const lines = containerText
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => l && !isUnwantedTitle(l) && l.length >= 4);
    if (lines.length > 0) {
      return lines[0];
    }
  }

  return null;
}

export function parseHtmlLinks(
  html: string,
  baseUrl: string,
  hostSuffix?: string,
  urlPredicate: (url: string) => boolean = () => true,
): HtmlLinkItem[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const items: HtmlLinkItem[] = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const sourceUrl = sourceUrlFromHref(href, baseUrl, hostSuffix);
    if (!sourceUrl || seen.has(sourceUrl) || !urlPredicate(sourceUrl)) return;

    let title = compactText($(element).text());
    const container = $(element).closest(
      ".dataset-item, .module-content, .media, article, li, div, tr",
    );

    if (isUnwantedTitle(title)) {
      const better = extractBetterTitle($, element, container, href);
      if (better) {
        title = compactText(better);
      }
    }

    if (!title || title.length < 4 || isUnwantedTitle(title)) return;

    const snippet = compactText(container.text());
    seen.add(sourceUrl);
    items.push({
      title,
      url: sourceUrl,
      snippet: truncateForTelegram(snippet || title, 900),
    });
  });

  return items;
}

function datosGobSearchUrl(query: string): string {
  const url = new URL(DATOS_GOB_DATASET_SEARCH);
  url.searchParams.set("q", query);
  return url.toString();
}

function dofSearchUrl(query: string): string {
  const url = new URL(DOF_SEARCH);
  url.searchParams.set("textobusqueda", query);
  return url.toString();
}

function buildHighSignalQueries(
  profile: CommercialProfile,
  _morelosOnly: boolean,
  targetLocations?: string[],
): string[] {
  const keywordSeeds = profile.primaryKeywords.slice(0, 8);
  const signalSeeds = profile.strongContextKeywords.slice(0, 4);
  const geoSeeds = targetLocations?.length
    ? targetLocations
    : ["Morelos", "Guadalajara", "CDMX", "Edomex"];
  const geo = `${geoSeeds.slice(0, 4).join(" OR ")} `;

  const queries = [
    `${geo}${keywordSeeds.slice(0, 3).join(" OR ")} contrato`,
    `${geo}${signalSeeds.slice(0, 2).join(" ")} ${keywordSeeds[0]}`,
    `${geo}${profile.businessLines.slice(0, 2).join(" ")} licitacion contrato`,
  ];

  queries.push(`nacional ${keywordSeeds[0]} ${signalSeeds[0] ?? "convocatoria"}`);

  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
}

function extractPublishedAt(evidence: string): string | null {
  const isoMatch = evidence.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00.000Z`;

  const slashMatch = evidence.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, "0");
    const month = slashMatch[2].padStart(2, "0");
    return `${slashMatch[3]}-${month}-${day}T00:00:00.000Z`;
  }

  const dofMatch = evidence.match(
    /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(20\d{2})\b/i,
  );
  if (!dofMatch) return null;

  const months: Record<string, string> = {
    enero: "01",
    febrero: "02",
    marzo: "03",
    abril: "04",
    mayo: "05",
    junio: "06",
    julio: "07",
    agosto: "08",
    septiembre: "09",
    octubre: "10",
    noviembre: "11",
    diciembre: "12",
  };
  const month = months[dofMatch[2].toLowerCase()];
  return month
    ? `${dofMatch[3]}-${month}-${dofMatch[1].padStart(2, "0")}T00:00:00.000Z`
    : null;
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
    "contrataciones",
  ];

  return areas.find((area) => evidence.toLowerCase().includes(area)) ?? null;
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
  if (lower.includes("capufe") || lower.includes("caminos y puentes federales")) {
    return "organismo publico federal";
  }
  return null;
}

function amountVisibleInEvidence(evidence: string): boolean {
  return /\$?\s?\d{1,3}(,\d{3})+(\.\d{2})?|\b\d+(\.\d{2})?\s?(mxn|pesos)\b/i.test(
    evidence,
  );
}

function amountFromEvidence(evidence: string): number | null {
  const match = evidence.match(/\$?\s?(\d{1,3}(?:,\d{3})+)(?:\.\d{2})?/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function procedureIdFromEvidence(evidence: string): string | null {
  const match = evidence.match(
    /\b(?:LA|LPN|LPI|IA|AD|LO|EO|PC|COMPRASMX)[-\s/]?[A-Z0-9-]{6,}\b/i,
  );
  return match ? match[0].trim() : null;
}

function profileToVertical(profile: CommercialProfile): ExternalLeadVertical {
  switch (profile.id) {
    case "hm_highmil_lubricants":
      return "aceites_lubricantes";
    case "primasa_printing":
      return "impresos_primasa";
    case "coformex_printing":
      return "impresos_coformex";
    case "uniforce_security_risk":
      return "seguridad_confianza_riesgo";
    case "grupo_constructor_nag_construction":
      return "construccion_mantenimiento";
  }
}

function profileKeywords(profile: CommercialProfile): string[] {
  return [
    ...profile.primaryKeywords,
    ...profile.secondaryKeywords,
    ...profile.strongContextKeywords,
    ...profile.weakContextKeywords,
  ];
}

function dependencyFromEvidence(evidence: string, fallback: string | null): string | null {
  const normalized = compactText(evidence);
  const dependencyMatch = normalized.match(
    /\b(CAPUFE|Caminos y Puentes Federales[^.,;]{0,80}|IMSS[^.,;]{0,80}|ISSSTE[^.,;]{0,80}|CONAVI[^.,;]{0,80}|Ayuntamiento de [A-ZÁÉÍÓÚÑ][^.,;]{2,80}|Secretar[ií]a [^.,;]{2,100})/i,
  );
  return dependencyMatch ? dependencyMatch[1].trim() : fallback;
}

function itemEvidence(item: Pick<HtmlLinkItem, "title" | "snippet">): string {
  return truncateForTelegram([item.title ?? "", item.snippet ?? ""].join(" "), 900);
}

export function isPressReleaseText(text: string): boolean {
  const norm = text.toLowerCase();
  const pressReleaseSignals = [
    "comunicado de prensa",
    "comunicado oficial",
    "boletin de prensa",
    "boletín de prensa",
    "nota de prensa",
    "comunicado n",
    "comunicado num",
    "comunicado núm",
    "sala de prensa",
    "boletin informativo",
    "boletín informativo",
  ];
  return pressReleaseSignals.some((signal) => norm.includes(signal));
}

export function adjustPressReleaseScore(
  commercialScore: number,
  reasons: string[],
  title: string,
  text: string,
  sourceType: string,
): { score: number; reasons: string[] } {
  if (sourceType !== "press_release") {
    return { score: commercialScore, reasons };
  }
  const textNorm = (title + " " + text).toLowerCase();
  const strongTenderSignals = [
    "licitacion",
    "licitación",
    "convocatoria",
    "contratacion",
    "contratación",
    "adquisicion",
    "adquisición",
    "adjudicacion",
    "adjudicación",
    "bases",
    "fallo",
    "proveedor",
    "invitacion",
    "invitación",
    "concurso",
    "servicio requerido",
    "procedimiento",
  ];
  const hasStrongSignal = strongTenderSignals.some((signal) => textNorm.includes(signal));
  const newReasons = [...reasons];
  let finalScore = commercialScore;
  if (hasStrongSignal) {
    finalScore = Math.min(finalScore, 65);
    if (!newReasons.includes("official_procurement_signal")) newReasons.push("official_procurement_signal");
    if (!newReasons.includes("public_tender_evidence")) newReasons.push("public_tender_evidence");
  } else {
    finalScore = Math.min(finalScore, 35);
    if (!newReasons.includes("press_release_weak_signal")) newReasons.push("press_release_weak_signal");
  }
  return { score: finalScore, reasons: newReasons };
}

export function normalizeRawItem(raw: RawExternalItem, profile: CommercialProfile): NormalizedExternalLead | null {
  const sourceUrl = sanitizePublicUrl(raw.sourceUrl);
  if (!sourceUrl) return null;

  if (raw.title && isUnwantedTitle(raw.title)) {
    return null;
  }

  const evidence = itemEvidence({
    title: raw.title ?? profile.displayName,
    snippet: raw.snippet ?? "",
  });
  const title = raw.title ?? profile.displayName;
  const matchedKeywords = findMatchingTerms(evidence, profileKeywords(profile));
  const scope = detectCommercialTerritory({
    text: evidence,
    territories: profile.territories,
  });
  const contactArea = buyerAreaFromEvidence(evidence);
  const publishedAt = raw.publishedAt ?? extractPublishedAt(evidence);
  const dependency =
    dependencyFromEvidence(evidence, raw.raw.dependency as string | null) ??
    raw.sourceName;

  const isPress = (sourceUrl && sourceUrl.includes("/prensa/")) ||
    isPressReleaseText(title + " " + evidence);
  const finalSourceType = isPress ? "press_release" : raw.sourceType;

  return {
    sourceId: raw.sourceId,
    sourceName: raw.sourceName,
    sourceType: finalSourceType,
    sourceUrl,
    canonicalUrl: canonicalizeExternalUrl(sourceUrl),
    detectedAt: nowISO(),
    title,
    organizationName: dependency,
    organizationType: organizationTypeFromEvidence(evidence),
    dependency,
    state: scope.territoryMatched,
    municipality: scope.matchedTerms.find((term) => term !== scope.territoryMatched) ?? null,
    sector: profile.displayName,
    vertical: profileToVertical(profile),
    matchedKeywords,
    evidenceText: evidence,
    contactArea,
    contactNamePublicOptional: null,
    contactEmailPublicOptional: null,
    contactPhonePublicOptional: null,
    amount: amountFromEvidence(evidence),
    amountVisible: amountVisibleInEvidence(evidence),
    buyerAreaIdentified: contactArea !== null,
    opportunityType: inferOpportunityType(evidence),
    isOfficialSource: isAllowedOfficialSourceUrl(sourceUrl),
    sourcePublishedAt: publishedAt,
    procedureId: procedureIdFromEvidence(evidence),
    raw: {
      ...raw.raw,
      fetchedAt: raw.fetchedAt,
      sourceType: finalSourceType,
      referenceCompany: profile.companyName,
      commercialProfileId: profile.id,
    },
  };
}

function sanitizeNormalizedLead(normalized: NormalizedExternalLead): SanitizedExternalLead | null {
  const title = redactSensitivePublicData(normalized.title);
  const evidenceText = redactSensitivePublicData(normalized.evidenceText);
  const sourceUrl = sanitizePublicUrl(normalized.sourceUrl);
  if (!sourceUrl) return null;

  if (!title.trim() || !evidenceText.trim()) return null;

  return {
    ...normalized,
    sourceUrl,
    canonicalUrl: canonicalizeExternalUrl(sourceUrl),
    title,
    evidenceText,
    sanitizedAt: nowISO(),
  };
}

function evidenceFromRaw(raw: RawExternalItem): ExternalLeadEvidence {
  const text = itemEvidence({
    title: raw.title ?? raw.sourceName,
    snippet: raw.snippet ?? "",
  });
  return {
    title: raw.title ?? raw.sourceName,
    text,
    publicUrl: sanitizePublicUrl(raw.sourceUrl),
    sourceName: raw.sourceName,
    publishedAt: raw.publishedAt ?? extractPublishedAt(text),
    matchedKeywords: [],
    amountVisible: amountVisibleInEvidence(text),
    buyerAreaIdentified: buyerAreaFromEvidence(text) !== null,
  };
}

class HtmlSearchAdapter implements SourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: ExternalSourceType;
  readonly enabled: boolean;
  readonly query: string;
  readonly url: string;

  constructor(
    private readonly descriptor: AdapterDescriptor,
    private readonly hostSuffix: string,
    private readonly urlPredicate: (url: string) => boolean,
    enabled = true,
  ) {
    this.id = descriptor.sourceId;
    this.name = descriptor.sourceName;
    this.type = descriptor.sourceType;
    this.enabled = enabled;
    this.query = descriptor.query;
    this.url = descriptor.url;
  }

  async fetchRaw(options: ExternalLeadRunOptions): Promise<RawExternalItem[]> {
    const response = await axios.get<string>(this.descriptor.url, {
      timeout: options.sourceTimeoutMs,
      headers: { "User-Agent": USER_AGENT },
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 400) {
      const error = new Error(`HTTP ${response.status}`);
      (error as Error & { httpStatus?: number }).httpStatus = response.status;
      throw error;
    }

    return parseHtmlLinks(
      response.data,
      this.descriptor.url,
      this.hostSuffix,
      this.urlPredicate,
    )
      .slice(0, options.maxRawResultsPerSource)
      .map((item) => ({
        sourceId: this.id,
        sourceName: this.name,
        sourceType: this.type,
        sourceUrl: item.url,
        title: item.title,
        snippet: item.snippet,
        publishedAt: extractPublishedAt(item.snippet),
        fetchedAt: nowISO(),
        raw: {
          query: this.descriptor.query,
          queryUrl: this.descriptor.url,
          httpStatus: response.status,
          vertical: this.descriptor.profile.id,
        },
      }));
  }

  normalize(raw: RawExternalItem): NormalizedExternalLead | null {
    return normalizeRawItem(raw, this.descriptor.profile);
  }

  sanitize(normalized: NormalizedExternalLead): SanitizedExternalLead | null {
    return sanitizeNormalizedLead(normalized);
  }

  score(sanitized: SanitizedExternalLead, options: ExternalLeadRunOptions): ScoredExternalLead {
    const commercial = matchCommercialOpportunity(
      {
        title: sanitized.title,
        description: sanitized.evidenceText,
        buyerName: sanitized.organizationName,
        dependency: sanitized.dependency,
        unit: sanitized.contactArea,
        procedureId: sanitized.procedureId,
        source: sanitized.sourceName,
        sourceUrl: sanitized.sourceUrl,
        publicationDate: sanitized.sourcePublishedAt,
        state: sanitized.state,
        municipality: sanitized.municipality,
        fullText: sanitized.evidenceText,
      },
      {
        profiles: [this.descriptor.profile],
        minScore: options.minScore,
        requireTerritory: true,
        debug: options.debugDiscards,
      },
    );
    const profileMatch = commercial.matchedProfiles[0] ?? commercial.topDiscardedProfiles[0];
    const adjusted = adjustPressReleaseScore(
      commercial.score,
      commercial.scoreReasons,
      sanitized.title,
      sanitized.evidenceText,
      sanitized.sourceType,
    );
    const scored: ScoredExternalLead = {
      ...sanitized,
      estimatedInterestScore: adjusted.score,
      confidence: adjusted.score >= 75 ? "HIGH" : adjusted.score >= 45 ? "MEDIUM" : "LOW",
      nextAction: (adjusted.score >= 45 && commercial.shouldAlert)
        ? "revisar oportunidad publica y validar convocatoria"
        : "monitorear candidato comercial",
      scoreReasons: adjusted.reasons,
      scoreBreakdown: {
        keywordScore: profileMatch?.keywordMatches.primary.length ? 30 : 0,
        freshnessScore: sanitized.sourcePublishedAt ? 8 : 2,
        sourceTrustScore: sanitized.isOfficialSource ? 16 : 5,
        geographyScore: profileMatch?.territoryMatched ? 18 : 0,
        opportunityScore: profileMatch?.keywordMatches.strongContext.length ? 16 : 5,
        evidenceScore: sanitized.sourceUrl ? 10 : 0,
        urgencyScore: 0,
        finalScore: adjusted.score,
      },
      fingerprintHash: "",
    };
    scored.fingerprintHash = this.buildFingerprint(scored);
    return scored;
  }

  buildFingerprint(scored: ScoredExternalLead): string {
    return buildExternalLeadFingerprint(scored);
  }

  extractEvidence(raw: RawExternalItem): ExternalLeadEvidence {
    return evidenceFromRaw(raw);
  }
}

class OfficialWebsiteAdapter extends HtmlSearchAdapter {
  constructor(site: OfficialWebsiteConfig, profile: CommercialProfile) {
    super(
      {
        sourceId: `official-website:${site.id}:${profile.id}`,
        sourceName: site.name,
        sourceType: "official_website",
        query: `${site.name} ${profile.displayName}`,
        url: site.url,
        profile,
      },
      ".gob.mx",
      () => true,
      site.enabled,
    );
  }
}

class DisabledScaffoldAdapter implements SourceAdapter {
  readonly query = "scaffold";
  readonly url: string;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly type: ExternalSourceType,
    private readonly profile: CommercialProfile,
    private readonly publicUrl: string,
  ) {
    this.url = publicUrl;
  }

  readonly enabled = false;

  async fetchRaw(): Promise<RawExternalItem[]> {
    return [];
  }

  normalize(raw: RawExternalItem): NormalizedExternalLead | null {
    return normalizeRawItem(raw, this.profile);
  }

  sanitize(normalized: NormalizedExternalLead): SanitizedExternalLead | null {
    return sanitizeNormalizedLead(normalized);
  }

  score(sanitized: SanitizedExternalLead, options: ExternalLeadRunOptions): ScoredExternalLead {
    const commercial = matchCommercialOpportunity(
      {
        title: sanitized.title,
        description: sanitized.evidenceText,
        dependency: sanitized.dependency,
        source: sanitized.sourceName,
        sourceUrl: sanitized.sourceUrl,
        publicationDate: sanitized.sourcePublishedAt,
        state: sanitized.state,
        municipality: sanitized.municipality,
        fullText: sanitized.evidenceText,
      },
      { profiles: [this.profile], minScore: options.minScore, requireTerritory: true },
    );
    const adjusted = adjustPressReleaseScore(
      commercial.score,
      commercial.scoreReasons,
      sanitized.title,
      sanitized.evidenceText,
      sanitized.sourceType,
    );
    const scored: ScoredExternalLead = {
      ...sanitized,
      estimatedInterestScore: adjusted.score,
      confidence: adjusted.score >= 75 ? "HIGH" : adjusted.score >= 45 ? "MEDIUM" : "LOW",
      nextAction: "monitorear candidato comercial",
      scoreReasons: adjusted.reasons,
      scoreBreakdown: {
        keywordScore: 0,
        freshnessScore: sanitized.sourcePublishedAt ? 8 : 2,
        sourceTrustScore: sanitized.isOfficialSource ? 16 : 5,
        geographyScore: commercial.territoryMatched ? 18 : 0,
        opportunityScore: 0,
        evidenceScore: sanitized.sourceUrl ? 10 : 0,
        urgencyScore: 0,
        finalScore: adjusted.score,
      },
      fingerprintHash: "",
    };
    scored.fingerprintHash = this.buildFingerprint(scored);
    return scored;
  }

  buildFingerprint(scored: ScoredExternalLead): string {
    return buildExternalLeadFingerprint(scored);
  }

  extractEvidence(raw: RawExternalItem): ExternalLeadEvidence {
    return {
      ...evidenceFromRaw(raw),
      publicUrl: sanitizePublicUrl(this.publicUrl),
    };
  }
}

class RssSourceAdapter implements SourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: ExternalSourceType = "rss";
  readonly enabled: boolean;
  readonly query: string;
  readonly url: string;

  constructor(private readonly feed: RssConfig, private readonly profile: CommercialProfile) {
    this.id = `rss:${feed.id}:${profile.id}`;
    this.name = feed.name;
    this.enabled = feed.enabled;
    this.query = feed.name;
    this.url = feed.url;
  }

  async fetchRaw(options: ExternalLeadRunOptions): Promise<RawExternalItem[]> {
    const response = await axios.get<string>(this.feed.url, {
      timeout: options.sourceTimeoutMs,
      headers: { "User-Agent": USER_AGENT },
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 400) {
      const error = new Error(`HTTP ${response.status}`);
      (error as Error & { httpStatus?: number }).httpStatus = response.status;
      throw error;
    }

    const $ = cheerio.load(response.data, { xmlMode: true });
    const items: RawExternalItem[] = [];
    $("item, entry").each((_, element) => {
      const title = compactText($(element).find("title").first().text());
      const link =
        compactText($(element).find("link").first().text()) ||
        $(element).find("link").first().attr("href") ||
        "";
      const snippet = compactText(
        $(element).find("description, summary, content").first().text(),
      );
      const publishedAt = compactText(
        $(element).find("pubDate, published, updated").first().text(),
      );
      const parsedDate = publishedAt ? new Date(publishedAt) : null;
      items.push({
        sourceId: this.id,
        sourceName: this.name,
        sourceType: this.type,
        sourceUrl: sanitizePublicUrl(link),
        title,
        snippet,
        publishedAt:
          parsedDate && Number.isFinite(parsedDate.getTime())
            ? parsedDate.toISOString()
            : null,
        fetchedAt: nowISO(),
        raw: {
          feedUrl: this.feed.url,
          httpStatus: response.status,
          vertical: this.profile.id,
        },
      });
    });

    return items.slice(0, options.maxRawResultsPerSource);
  }

  normalize(raw: RawExternalItem): NormalizedExternalLead | null {
    return normalizeRawItem(raw, this.profile);
  }

  sanitize(normalized: NormalizedExternalLead): SanitizedExternalLead | null {
    return sanitizeNormalizedLead(normalized);
  }

  score(sanitized: SanitizedExternalLead, options: ExternalLeadRunOptions): ScoredExternalLead {
    const commercial = matchCommercialOpportunity(
      {
        title: sanitized.title,
        description: sanitized.evidenceText,
        dependency: sanitized.dependency,
        source: sanitized.sourceName,
        sourceUrl: sanitized.sourceUrl,
        publicationDate: sanitized.sourcePublishedAt,
        state: sanitized.state,
        municipality: sanitized.municipality,
        fullText: sanitized.evidenceText,
      },
      { profiles: [this.profile], minScore: options.minScore, requireTerritory: true },
    );
    const adjusted = adjustPressReleaseScore(
      commercial.score,
      commercial.scoreReasons,
      sanitized.title,
      sanitized.evidenceText,
      sanitized.sourceType,
    );
    const scored: ScoredExternalLead = {
      ...sanitized,
      estimatedInterestScore: adjusted.score,
      confidence: adjusted.score >= 75 ? "HIGH" : adjusted.score >= 45 ? "MEDIUM" : "LOW",
      nextAction: (adjusted.score >= 45 && commercial.shouldAlert)
        ? "revisar oportunidad publica y validar convocatoria"
        : "monitorear candidato comercial",
      scoreReasons: adjusted.reasons,
      scoreBreakdown: {
        keywordScore: commercial.keywordMatches.length ? 30 : 0,
        freshnessScore: sanitized.sourcePublishedAt ? 8 : 2,
        sourceTrustScore: sanitized.isOfficialSource ? 16 : 5,
        geographyScore: commercial.territoryMatched ? 18 : 0,
        opportunityScore: commercial.scoreReasons.some((reason) => reason.includes("contratacion")) ? 16 : 5,
        evidenceScore: sanitized.sourceUrl ? 10 : 0,
        urgencyScore: 0,
        finalScore: adjusted.score,
      },
      fingerprintHash: "",
    };
    scored.fingerprintHash = this.buildFingerprint(scored);
    return scored;
  }

  buildFingerprint(scored: ScoredExternalLead): string {
    return buildExternalLeadFingerprint(scored);
  }

  extractEvidence(raw: RawExternalItem): ExternalLeadEvidence {
    return evidenceFromRaw(raw);
  }
}

const OFFICIAL_WEBSITES: OfficialWebsiteConfig[] = [
  {
    id: "capufe-prensa",
    name: "CAPUFE sitio oficial",
    url: "https://www.gob.mx/capufe/archivo/prensa",
    enabled: true,
  },
  {
    id: "imss-prensa",
    name: "IMSS sitio oficial",
    url: "https://www.gob.mx/imss/archivo/prensa",
    enabled: true,
  },
  {
    id: "issste-prensa",
    name: "ISSSTE sitio oficial",
    url: "https://www.gob.mx/issste/archivo/prensa",
    enabled: true,
  },
  {
    id: "conavi-prensa",
    name: "CONAVI sitio oficial",
    url: "https://www.gob.mx/conavi/archivo/prensa",
    enabled: true,
  },
];

const RSS_FEEDS: RssConfig[] = [];

export function buildExternalSourceAdapters(options: ExternalLeadRunOptions): SourceAdapter[] {
  const adapters: SourceAdapter[] = [];

  for (const profile of COMMERCIAL_PROFILES) {
    const queries = buildHighSignalQueries(
      profile,
      options.morelosOnly,
      options.targetLocations,
    ).slice(0, 3);

    for (const query of queries) {
      adapters.push(
        new HtmlSearchAdapter(
          {
            sourceId: `datos-gob:${profile.id}:${query}`,
            sourceName: "datos.gob.mx",
            sourceType: "datos_gob_mx",
            query,
            url: datosGobSearchUrl(query),
            profile,
          },
          "datos.gob.mx",
          (url) => {
            try {
              const parsed = new URL(url);
              return parsed.pathname.includes("/dataset/") &&
                parsed.pathname !== "/dataset/" &&
                parsed.pathname !== "/dataset";
            } catch {
              return false;
            }
          },
        ),
      );
    }

    const dofQuery = [
      profile.primaryKeywords[0],
      "licitacion",
      "adquisiciones",
      commercialTerritoryAliases(profile.territories).slice(0, 4).join(" OR "),
    ]
      .filter(Boolean)
      .join(" ");
    adapters.push(
      new HtmlSearchAdapter(
        {
          sourceId: `dof:${profile.id}:${dofQuery}`,
          sourceName: "Diario Oficial de la Federación",
          sourceType: "dof",
          query: dofQuery,
          url: dofSearchUrl(dofQuery),
          profile,
        },
        "dof.gob.mx",
        (url) => url.includes("nota_detalle") || url.includes("busqueda_detalle"),
      ),
    );

    for (const site of OFFICIAL_WEBSITES) {
      adapters.push(new OfficialWebsiteAdapter(site, profile));
    }

    for (const feed of RSS_FEEDS) {
      adapters.push(new RssSourceAdapter(feed, profile));
    }
  }

  const scaffoldProfile = COMMERCIAL_PROFILES[0];
  adapters.push(
    new DisabledScaffoldAdapter(
      "official-gazette:generic",
      "Gaceta oficial estatal configurable",
      "official_gazette",
      scaffoldProfile,
      "",
    ),
    new DisabledScaffoldAdapter(
      "rss:generic",
      "RSS público configurable",
      "rss",
      scaffoldProfile,
      "",
    ),
    new DisabledScaffoldAdapter(
      "pdf:public-document",
      "PDF público configurable",
      "pdf",
      scaffoldProfile,
      "",
    ),
    new DisabledScaffoldAdapter(
      "pnt-sipot:configurable",
      "PNT / SIPOT configurable",
      "pnt_sipot",
      scaffoldProfile,
      "https://www.plataformadetransparencia.org.mx/",
    ),
  );

  return adapters;
}

export function scoredLeadToCandidate(scored: ScoredExternalLead) {
  return {
    sourceId: scored.sourceId,
    sourceName: scored.sourceName,
    sourceUrl: scored.sourceUrl,
    canonicalUrl: scored.canonicalUrl,
    detectedAt: scored.detectedAt,
    title: scored.title,
    organizationName: scored.organizationName,
    organizationType: scored.organizationType,
    dependency: scored.dependency,
    state: scored.state,
    municipality: scored.municipality,
    sector: scored.sector,
    vertical: scored.vertical,
    matchedKeywords: scored.matchedKeywords,
    evidenceText: scored.evidenceText,
    contactArea: scored.contactArea,
    contactNamePublicOptional: scored.contactNamePublicOptional,
    contactEmailPublicOptional: scored.contactEmailPublicOptional,
    contactPhonePublicOptional: scored.contactPhonePublicOptional,
    amount: scored.amount,
    amountVisible: scored.amountVisible,
    buyerAreaIdentified: scored.buyerAreaIdentified,
    opportunityType: scored.opportunityType,
    isOfficialSource: scored.isOfficialSource,
    sourcePublishedAt: scored.sourcePublishedAt,
    procedureId: scored.procedureId,
    scoreReasons: scored.scoreReasons,
    scoreBreakdown: scored.scoreBreakdown,
    raw: {
      ...scored.raw,
      fingerprintHash: scored.fingerprintHash,
    },
  };
}
