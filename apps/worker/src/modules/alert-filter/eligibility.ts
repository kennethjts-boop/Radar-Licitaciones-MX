import type { NormalizedProcurement } from '../../types/procurement';
import type { UpsertProcurementResult } from '../../storage/procurement.repo';
import type { AlertClassification, AlertFilterOptions, NormalizedTenderStatus } from './types';
import { normalizeTenderStatus } from './status-normalizer';
import { extractTenderDates, isTenderStillActionable, isWithinDays } from './date-utils';

const DEFAULT_OPTIONS: AlertFilterOptions = {
  desertaLookbackDays: 10,
  activeMaxAgeDays: 21,
};

const CLOSED_STATUSES: NormalizedTenderStatus[] = ['CLOSED', 'AWARDED', 'CANCELLED', 'EXPIRED'];

const CLOSED_REASON_MAP: Partial<Record<NormalizedTenderStatus, string>> = {
  CLOSED: 'new_but_closed',
  AWARDED: 'new_but_awarded',
  CANCELLED: 'new_but_cancelled',
  EXPIRED: 'new_but_expired',
};

export function classifyAlert(
  item: NormalizedProcurement,
  upsertResult: UpsertProcurementResult,
  options: AlertFilterOptions = DEFAULT_OPTIONS,
  now: Date = new Date(),
): AlertClassification {
  const normalizedStatus = normalizeTenderStatus(item.status);
  const dates = extractTenderDates(item);
  const hasActionableDates = isTenderStillActionable(dates, now);

  if (upsertResult.isNew) {
    if (CLOSED_STATUSES.includes(normalizedStatus)) {
      const reason = (CLOSED_REASON_MAP[normalizedStatus] ?? 'new_but_closed') as any;
      return { decision: 'NOT_ALERTABLE', reason, normalizedStatus, hasActionableDates };
    }

    if (normalizedStatus === 'DESIERTA') {
      const refDate = dates.publicationDate ?? dates.firstSeenAt;
      if (refDate && !isWithinDays(refDate, options.desertaLookbackDays, now)) {
        return { decision: 'NOT_ALERTABLE', reason: 'desierta_too_old', normalizedStatus, hasActionableDates };
      }
      return { decision: 'ALERTABLE', reason: 'new_desierta', normalizedStatus, hasActionableDates };
    }

    return { decision: 'ALERTABLE', reason: 'new_active', normalizedStatus, hasActionableDates };
  }

  if (CLOSED_STATUSES.includes(normalizedStatus)) {
    return { decision: 'NOT_ALERTABLE', reason: 'old_closed_status', normalizedStatus, hasActionableDates };
  }

  if (normalizedStatus === 'DESIERTA') {
    if (isWithinDays(dates.firstSeenAt, options.desertaLookbackDays, now)) {
      return { decision: 'ALERTABLE', reason: 'recent_desierta', normalizedStatus, hasActionableDates };
    }
    return { decision: 'NOT_ALERTABLE', reason: 'desierta_too_old', normalizedStatus, hasActionableDates };
  }

  if (normalizedStatus === 'ACTIVE') {
    if (hasActionableDates) {
      return { decision: 'ALERTABLE', reason: 'active_with_future_dates', normalizedStatus, hasActionableDates };
    }
    return { decision: 'NOT_ALERTABLE', reason: 'old_no_future_dates', normalizedStatus, hasActionableDates };
  }

  return { decision: 'NOT_ALERTABLE', reason: 'unknown_status_old', normalizedStatus, hasActionableDates };
}
