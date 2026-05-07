/**
 * PROCUREMENT SCOPE FILTER
 *
 * Decide si una licitación está dentro del alcance geográfico/categórico
 * del radar. Encapsula la lógica de filtrado que actualmente vive dispersa
 * en collect.job.ts y los radares.
 *
 * Uso: NO integrar al collect.job.ts aún — solo crear el servicio y sus tests.
 */
import { createModuleLogger } from "../core/logger";

const log = createModuleLogger("procurement-scope-filter");

// ── Términos de Morelos ───────────────────────────────────────────────────────

const MORELOS_TERMS: string[] = [
  "morelos",
  "cuernavaca",
  "xochitepec",
  "jiutepec",
  "jojutla",
  "zacatepec",
  "temixco",
  "yautepec",
  "cuautla",
  "tlaltizapan",
  "tlaquiltenango",
  "puente de ixtla",
  "emiliano zapata",
  "huitzilac",
  "tepoztlan",
  "tlayacapan",
  "yecapixtla",
  "axochiapan",
  "ayala",
  "miacatlan",
  "mazatepec",
  "tetecala",
  "coatlan del rio",
  "amacuzac",
  "jonacatepec",
  "tepalcingo",
  "ocuituco",
  "tetela del volcan",
  "totolapan",
  "atlatlahucan",
  "jantetelco",
  "temoac",
  "zacualpan de amilpas",
  "coatetelco",
  "xoxocotla",
  "hueyapan",
];

const CAPUFE_TERMS: string[] = ["capufe", "caminos y puentes"];

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type ProcurementScope =
  | "MORELOS_ONLY"
  | "NATIONAL_CAPUFE_DESIERTA"
  | "REJECTED_OUT_OF_SCOPE";

export interface ProcurementScopeInput {
  radar_name?: string;
  title?: string | null;
  dependency?: string | null;
  state?: string | null;
  municipality?: string | null;
  status?: string | null;
  canonical_text?: string | null;
}

export interface ProcurementScopeResult {
  allowed: boolean;
  scope: ProcurementScope;
  reasons: string[];
  detected_state: string | null;
  detected_municipality: string | null;
  is_capufe: boolean;
  is_desierta: boolean;
  is_morelos_related: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function textContains(
  text: string | null | undefined,
  terms: string[],
): boolean {
  if (!text) return false;
  const normalized = normalizeText(text);
  return terms.some((term) => normalized.includes(term));
}

// ── Función principal ─────────────────────────────────────────────────────────

export function filterProcurementScope(
  input: ProcurementScopeInput,
): ProcurementScopeResult {
  // 1. Detectar CAPUFE: dependency, title, o canonical_text
  const is_capufe =
    textContains(input.dependency, CAPUFE_TERMS) ||
    textContains(input.title, CAPUFE_TERMS) ||
    textContains(input.canonical_text, CAPUFE_TERMS);

  // 2. Detectar DESIERTA: status (cubre "desierta" y "desierto")
  const is_desierta = textContains(input.status, ["desierta", "desierto"]);

  // 3. Detectar relación con Morelos: state, municipality, canonical_text
  const is_morelos_related =
    textContains(input.state, MORELOS_TERMS) ||
    textContains(input.municipality, MORELOS_TERMS) ||
    textContains(input.canonical_text, MORELOS_TERMS);

  // 4. Árbol de decisión
  let allowed: boolean;
  let scope: ProcurementScope;
  const reasons: string[] = [];

  if (is_capufe && is_desierta) {
    allowed = true;
    scope = "NATIONAL_CAPUFE_DESIERTA";
    reasons.push("Licitación CAPUFE declarada desierta — alcance nacional");
    if (is_capufe) reasons.push("Dependencia/título contiene términos CAPUFE");
    if (is_desierta) reasons.push("Status contiene 'desierta'");
  } else if (is_morelos_related) {
    allowed = true;
    scope = "MORELOS_ONLY";
    reasons.push("Ubicación coincide con términos del Estado de Morelos");
  } else {
    allowed = false;
    scope = "REJECTED_OUT_OF_SCOPE";
    reasons.push(
      "No coincide con Morelos ni con criterio CAPUFE+desierta nacional",
    );
  }

  const result: ProcurementScopeResult = {
    allowed,
    scope,
    reasons,
    detected_state: input.state ?? null,
    detected_municipality: input.municipality ?? null,
    is_capufe,
    is_desierta,
    is_morelos_related,
  };

  if (allowed) {
    log.info(
      { scope, reasons, radar: input.radar_name ?? "unknown" },
      "Licitación dentro del alcance",
    );
  } else {
    log.info(
      { scope, reason: reasons[0], radar: input.radar_name ?? "unknown" },
      "Rechazada por alcance",
    );
  }

  return result;
}
