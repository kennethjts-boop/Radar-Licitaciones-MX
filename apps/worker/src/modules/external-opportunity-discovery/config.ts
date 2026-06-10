import type { AppConfig } from "../../config/env";

type ExternalOsintConfig = Pick<
  AppConfig,
  | "ENABLE_EXTERNAL_LEADS_OSINT"
  | "EXTERNAL_LEADS_DRY_RUN"
  | "EXTERNAL_LEADS_DISCOVERY_MODE"
>;

export interface ExternalOsintOperationalView {
  disabled: boolean;
  enabled: boolean;
  status: string;
  reason: string;
  dryRun: boolean;
  discoveryMode: boolean;
  sourcesReviewed: number;
  rawResultsReceived: number;
  normalized: number;
  detected: number;
  saved: number;
  alerted: number;
  errors: string[];
  topDiscardedCandidates: unknown[];
  topErrors: unknown[];
  state: Record<string, unknown> | null;
}

export function isExternalOsintEnabled(
  config: Pick<ExternalOsintConfig, "ENABLE_EXTERNAL_LEADS_OSINT">,
): boolean {
  return config.ENABLE_EXTERNAL_LEADS_OSINT === true;
}

function numberField(
  state: Record<string, unknown> | null | undefined,
  key: string,
): number {
  const value = state?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function getExternalOsintOperationalView(
  config: ExternalOsintConfig,
  state: Record<string, unknown> | null,
): ExternalOsintOperationalView {
  if (!isExternalOsintEnabled(config)) {
    return {
      disabled: true,
      enabled: false,
      status: "disabled",
      reason: "disabled_by_env",
      dryRun: false,
      discoveryMode: false,
      sourcesReviewed: 0,
      rawResultsReceived: 0,
      normalized: 0,
      detected: 0,
      saved: 0,
      alerted: 0,
      errors: [],
      topDiscardedCandidates: [],
      topErrors: [],
      state: null,
    };
  }

  return {
    disabled: false,
    enabled: true,
    status: String(state?.status ?? "none"),
    reason: String(state?.reason ?? ""),
    dryRun: config.EXTERNAL_LEADS_DRY_RUN,
    discoveryMode: config.EXTERNAL_LEADS_DISCOVERY_MODE,
    sourcesReviewed: numberField(state, "sourcesReviewed"),
    rawResultsReceived: numberField(state, "rawResultsReceived"),
    normalized: numberField(state, "normalized"),
    detected: numberField(state, "detected"),
    saved: numberField(state, "saved"),
    alerted: numberField(state, "alerted"),
    errors: Array.isArray(state?.errors)
      ? state.errors.map(String)
      : [],
    topDiscardedCandidates: Array.isArray(state?.topDiscardedCandidates)
      ? state.topDiscardedCandidates
      : [],
    topErrors: Array.isArray(state?.topErrors)
      ? state.topErrors
      : [],
    state,
  };
}
