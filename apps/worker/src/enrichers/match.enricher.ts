/**
 * ENRICHER — Construye EnrichedAlert con contexto histórico.
 * En Fase 0 el enriquecimiento es básico.
 * En Fase 6 se añaden antecedentes, resumenes ejecutivos y contexto histórico completo.
 */
import { createModuleLogger } from "../core/logger";
import { nowISO } from "../core/time";
import { getSupabaseClient } from "../storage/client";
import { formatMatchAlert } from "../alerts/telegram.alerts";
import { getRadarByKey } from "../radars/index";
import type {
  NormalizedProcurement,
  MatchResult,
  EnrichedAlert,
} from "../types/procurement";

const log = createModuleLogger("enricher");

/**
 * Enriquece un match con contexto histórico y construye el EnrichedAlert.
 */
export async function enrichMatch(
  procurement: NormalizedProcurement,
  match: MatchResult,
  modalidadProbable?: string,
): Promise<EnrichedAlert> {
  const radar = getRadarByKey(match.radarKey);

  // Verificar si existen versiones previas del expediente
  let historyCount = 0;
  let hasHistory = false;

  try {
    const { count } = await getSupabaseClient()
      .from("procurement_versions")
      .select("*", { count: "exact", head: true })
      .eq("procurement_id", match.procurementId);

    historyCount = count ?? 0;
    hasHistory = historyCount > 1; // >1 porque la versión actual ya se insertó
  } catch (err) {
    log.warn(
      { err },
      "Error obteniendo historial — continuando sin antecedentes",
    );
  }

  const alertType = match.isStatusChange
    ? "status_change"
    : match.isNew
      ? "new_match"
      : "new_match";

  const enriched: EnrichedAlert = {
    alertType,
    radarKey: match.radarKey,
    radarName: radar?.name ?? match.radarKey,
    matchLevel: match.matchLevel,
    matchScore: match.matchScore,
    procurement,
    matchedTerms: match.matchedTerms,
    explanation: match.explanation,
    hasHistory,
    historyCount,
    detectedAt: nowISO(),
    telegramMessage: "", // se genera abajo
    modalidadProbable,
  };

  // Generar mensaje Telegram
  enriched.telegramMessage = formatMatchAlert(enriched);

  return enriched;
}
