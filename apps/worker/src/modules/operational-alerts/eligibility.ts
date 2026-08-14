import { isValid, parse, parseISO } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { MX_TIMEZONE } from "../../core/time";

export const OPERATIONAL_PUBLICATION_CUTOFF_LOCAL = "2026-08-13T00:00:00";
export const OPERATIONAL_PUBLICATION_CUTOFF = fromZonedTime(
  OPERATIONAL_PUBLICATION_CUTOFF_LOCAL,
  MX_TIMEZONE,
);

export type NewTenderPublicationDecision =
  | { eligible: true; reason: "published_on_or_after_cutoff"; publishedAt: Date }
  | { eligible: false; reason: "published_before_cutoff"; publishedAt: Date }
  | { eligible: false; reason: "publication_date_unverifiable"; publishedAt: null };

/**
 * Las fechas naive de ComprasMX representan hora CDMX. Los ISO con offset se
 * respetan como instantes absolutos; una fecha sin hora equivale a medianoche CDMX.
 */
export function parseOfficialPublicationDate(raw: string | null | undefined): Date | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const date = fromZonedTime(`${value}T00:00:00`, MX_TIMEZONE);
      return isValid(date) ? date : null;
    }
    if (/^\d{2}\/\d{2}\/\d{4}(?: \d{2}:\d{2}(?::\d{2})?)?$/.test(value)) {
      const pattern = value.length === 10
        ? "dd/MM/yyyy"
        : value.length === 16
          ? "dd/MM/yyyy HH:mm"
          : "dd/MM/yyyy HH:mm:ss";
      const local = parse(value, pattern, new Date(0));
      if (!isValid(local)) return null;
      const components = [
        local.getFullYear(),
        String(local.getMonth() + 1).padStart(2, "0"),
        String(local.getDate()).padStart(2, "0"),
      ].join("-");
      const time = value.length === 10 ? "00:00:00" : value.slice(11).padEnd(8, ":00");
      const date = fromZonedTime(`${components}T${time}`, MX_TIMEZONE);
      return isValid(date) ? date : null;
    }
    const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
    const date = hasExplicitZone
      ? parseISO(value)
      : fromZonedTime(value, MX_TIMEZONE);
    return isValid(date) ? date : null;
  } catch {
    return null;
  }
}

export function evaluateNewTenderPublication(
  officialPublicationDate: string | null | undefined,
): NewTenderPublicationDecision {
  const publishedAt = parseOfficialPublicationDate(officialPublicationDate);
  if (!publishedAt) {
    return { eligible: false, reason: "publication_date_unverifiable", publishedAt: null };
  }
  return publishedAt >= OPERATIONAL_PUBLICATION_CUTOFF
    ? { eligible: true, reason: "published_on_or_after_cutoff", publishedAt }
    : { eligible: false, reason: "published_before_cutoff", publishedAt };
}
