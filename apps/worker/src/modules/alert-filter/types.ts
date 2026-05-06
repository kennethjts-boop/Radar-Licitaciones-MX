// src/modules/alert-filter/types.ts

export type NormalizedTenderStatus =
  | 'ACTIVE'
  | 'DESIERTA'
  | 'CLOSED'
  | 'AWARDED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'UNKNOWN';

export type AlertEligibility = 'ALERTABLE' | 'NOT_ALERTABLE';

export type AlertExclusionReason =
  | 'new_but_closed'
  | 'new_but_awarded'
  | 'new_but_cancelled'
  | 'new_but_expired'
  | 'old_no_future_dates'
  | 'old_closed_status'
  | 'desierta_too_old'
  | 'unknown_status_old';

export type AlertInclusionReason =
  | 'new_active'
  | 'new_desierta'
  | 'active_with_future_dates'
  | 'recent_desierta';

export type AlertReason = AlertInclusionReason | AlertExclusionReason;

export interface AlertClassification {
  decision: AlertEligibility;
  reason: AlertReason;
  normalizedStatus: NormalizedTenderStatus;
  hasActionableDates: boolean;
}

export interface TenderDates {
  publicationDate: Date | null;
  openingDate: Date | null;
  rulingDate: Date | null;
  clarificationDate: Date | null;
  firstSeenAt: Date | null;
}

export interface AlertFilterOptions {
  desertaLookbackDays: number;
  activeMaxAgeDays: number;
}

export interface CycleMetrics {
  found: number;
  alertable: number;
  sent: number;
  excluded: number;
  excludedClosed: number;
  excludedOld: number;
}

export interface SummarySection {
  title: string;
  externalId: string;
  dependencyName: string | null;
  openingDate: string | null;
  matchScore: number;
  sourceUrl: string;
  status: string;
}

export interface SummaryData {
  summaryDate: string;
  newActive: SummarySection[];
  recentDesierta: SummarySection[];
  soonExpiring: SummarySection[];
  highScore: SummarySection[];
  totalSeen: number;
  totalNew: number;
  totalAlerts: number;
  excludedCount: number;
  technicalIncidents: string[];
}
