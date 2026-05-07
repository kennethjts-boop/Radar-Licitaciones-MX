/**
 * PROCUREMENT SIMILARITY ENGINE — Calcula similitud textual (Jaccard) entre
 * la licitación actual y contratos históricos de tres fuentes públicas.
 * Sin embeddings; análisis léxico puro.
 */
import type { HistoricoContract } from "../collectors/compranet-historico/index";
import type { SipotContract } from "../collectors/pnt-sipot/index";
import type { OcdsContract } from "../collectors/contrataciones-abiertas/index";

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface SimilarityInput {
  title: string | null;
  dependency: string | null;
  state: string | null;
  contractType: string | null;
  /** Informational; full title tokenization is used for scoring. */
  keywords: string[];
  /** Passed through to SimilarityResult.scopeApplied; filtering is done upstream by collectors. */
  scope: "MORELOS_ONLY" | "NATIONAL_CAPUFE_DESIERTA";
  historico: HistoricoContract[];
  sipot: SipotContract[];
  ocds: OcdsContract[];
}

export interface SimilarProcedure {
  procedureId: string | null;
  source: "compranet-historico" | "pnt-sipot" | "contrataciones-abiertas";
  title: string | null;
  similarityScore: number;
  reason: string;
  awardedAmount: number | null;
  supplier: string | null;
  year: number | null;
  evidenceUrl: string | null;
}

export interface SimilarityResult {
  similarProcedures: SimilarProcedure[];
  totalFound: number;
  scopeApplied: string;
}

// ── Constantes ─────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "para", "con", "los", "las", "del", "que", "por", "una", "sus",
  "en", "de", "la", "el", "al", "se", "un", "es", "más",
]);
const MIN_SCORE = 0.15;
const MAX_RESULTS = 10;
const DEP_BONUS = 0.1;
const STATE_BONUS = 0.1;

// ── Helpers ────────────────────────────────────────────────────────────────────

function tokenize(text: string | null): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-záéíóúüñ\s]/gi, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface CandidateContract {
  procedureId: string | null;
  source: SimilarProcedure["source"];
  title: string | null;
  dependency: string | null;
  state: string | null;
  awardedAmount: number | null;
  supplier: string | null;
  year: number | null;
  evidenceUrl: string | null;
}

function normalizeCandidates(
  historico: HistoricoContract[],
  sipot: SipotContract[],
  ocds: OcdsContract[],
): CandidateContract[] {
  const h: CandidateContract[] = historico.map((c) => ({
    procedureId: c.procedureNumber,
    source: "compranet-historico" as const,
    title: c.title,
    dependency: c.dependency,
    state: c.state,
    awardedAmount: c.awardedAmount,
    supplier: c.supplier,
    year: c.year,
    evidenceUrl: c.sourceUrl,
  }));

  const s: CandidateContract[] = sipot.map((c) => ({
    procedureId: c.procedureNumber,
    source: "pnt-sipot" as const,
    title: c.title,
    dependency: c.dependency,
    state: c.state,
    awardedAmount: c.awardedAmount,
    supplier: c.supplier,
    year: c.year,
    evidenceUrl: c.sourceUrl,
  }));

  const o: CandidateContract[] = ocds.map((c) => ({
    procedureId: c.ocid ?? c.procedureNumber,
    source: "contrataciones-abiertas" as const,
    title: c.title,
    dependency: c.dependency,
    state: c.state,
    awardedAmount: c.awardedAmount,
    supplier: c.supplier,
    year: c.year,
    evidenceUrl: c.sourceUrl,
  }));

  return [...h, ...s, ...o];
}

// ── Función principal ──────────────────────────────────────────────────────────

export function findSimilarProcurements(
  input: SimilarityInput,
): SimilarityResult {
  const inputTokens = tokenize(input.title);
  const normalizedDep = (input.dependency ?? "").toLowerCase().trim();
  const normalizedState = (input.state ?? "").toLowerCase().trim();

  const candidates = normalizeCandidates(input.historico, input.sipot, input.ocds);

  const allScored: SimilarProcedure[] = candidates
    .map((c): SimilarProcedure | null => {
      const candidateTokens = tokenize(c.title);
      let score = jaccardSimilarity(inputTokens, candidateTokens);

      const reasons: string[] = [];
      if (score > 0) {
        reasons.push(`similitud textual ${(score * 100).toFixed(0)}%`);

        if (normalizedDep && (c.dependency ?? "").toLowerCase().trim() === normalizedDep) {
          score = Math.min(1.0, score + DEP_BONUS);
          reasons.push("misma dependencia");
        }
        if (normalizedState && (c.state ?? "").toLowerCase().trim() === normalizedState) {
          score = Math.min(1.0, score + STATE_BONUS);
          reasons.push("mismo estado");
        }
      }

      if (score < MIN_SCORE) return null;

      return {
        procedureId: c.procedureId,
        source: c.source,
        title: c.title,
        similarityScore: Math.round(score * 1000) / 1000,
        reason: reasons.join(", ") || "coincidencia general",
        awardedAmount: c.awardedAmount,
        supplier: c.supplier,
        year: c.year,
        evidenceUrl: c.evidenceUrl,
      };
    })
    .filter((p): p is SimilarProcedure => p !== null)
    .sort((a, b) => b.similarityScore - a.similarityScore);
  // Do NOT slice here yet

  return {
    similarProcedures: allScored.slice(0, MAX_RESULTS),
    totalFound: allScored.length,  // total matched, not total returned
    scopeApplied: input.scope,
  };
}
