import { parseISO, isValid } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import type { NormalizedProcurement } from '../../types/procurement';
import type { TenderDates } from './types';

const MX_TZ = 'America/Mexico_City';

function parseMexicoDate(raw: string | null | undefined): Date | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const d = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)
      ? fromZonedTime(raw, MX_TZ)
      : parseISO(raw);
    return isValid(d) ? d : null;
  } catch {
    return null;
  }
}

export function extractTenderDates(item: NormalizedProcurement): TenderDates {
  const raw = item.rawJson as Record<string, unknown>;
  return {
    publicationDate: parseMexicoDate(item.publicationDate),
    openingDate: parseMexicoDate(item.openingDate),
    rulingDate: parseMexicoDate(raw.fecha_fallo as string | null),
    clarificationDate: parseMexicoDate(raw.fecha_aclaraciones as string | null),
    firstSeenAt: parseMexicoDate(item.fetchedAt),
  };
}

export function isTenderStillActionable(dates: TenderDates, now: Date): boolean {
  const actionableDates = [dates.openingDate, dates.rulingDate, dates.clarificationDate].filter(
    (d): d is Date => d !== null,
  );
  if (actionableDates.length === 0) return true;
  return actionableDates.some((d) => d > now);
}

export function isWithinDays(date: Date | null, days: number, now: Date): boolean {
  if (!date) return false;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return date >= cutoff;
}
