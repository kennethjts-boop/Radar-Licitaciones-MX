import { getConfig } from "../../config/env";
import {
  getState,
  setStateStrict,
  STATE_KEYS,
} from "../../core/system-state";

export interface NetworkFailureSample {
  at: string;
  hour: number;
}

export interface NetworkFailureHistogram {
  samples: NetworkFailureSample[];
  startedAt?: string;
}

export interface SaturationAnalysis {
  currentHour: number;
  sampleCount: number;
  sufficient: boolean;
  peakHours: number[];
  isPeakHour: boolean;
  isAnomalous: boolean;
  message: string;
}

let histogramMutationQueue: Promise<void> = Promise.resolve();

function mexicoHour(date: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    timeZone: "America/Mexico_City",
  }).format(date);
  return Number(hour) % 24;
}

function normalizeHistogram(value: unknown): NetworkFailureHistogram {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { samples: [] };
  }
  const samples = (value as { samples?: unknown }).samples;
  if (!Array.isArray(samples)) return { samples: [] };
  return {
    startedAt: typeof (value as { startedAt?: unknown }).startedAt === "string"
      ? (value as { startedAt: string }).startedAt
      : undefined,
    samples: samples.flatMap((sample) => {
      if (
        typeof sample !== "object" ||
        sample === null ||
        Array.isArray(sample)
      ) {
        return [];
      }
      const candidate = sample as Partial<NetworkFailureSample>;
      if (
        typeof candidate.at !== "string" ||
        typeof candidate.hour !== "number" ||
        candidate.hour < 0 ||
        candidate.hour > 23 ||
        !Number.isFinite(Date.parse(candidate.at))
      ) {
        return [];
      }
      return [{ at: candidate.at, hour: candidate.hour }];
    }),
  };
}

function samplesInWindow(
  histogram: NetworkFailureHistogram,
  now: Date,
  windowDays: number,
): NetworkFailureSample[] {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return histogram.samples.filter((sample) => {
    const timestamp = Date.parse(sample.at);
    return timestamp >= cutoff && timestamp <= now.getTime();
  });
}

export function analyzeSaturation(input: {
  histogram: NetworkFailureHistogram;
  now: Date;
  windowDays: number;
  minSamples: number;
}): SaturationAnalysis {
  const currentHour = mexicoHour(input.now);
  const samples = samplesInWindow(
    input.histogram,
    input.now,
    input.windowDays,
  );
  const earliestSampleAt = input.histogram.startedAt ??
    input.histogram.samples
      .map((sample) => sample.at)
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
  const historyAgeMs = earliestSampleAt
    ? input.now.getTime() - Date.parse(earliestSampleAt)
    : 0;
  const hasFullWindow =
    historyAgeMs >= input.windowDays * 24 * 60 * 60 * 1000;
  if (samples.length < input.minSamples || !hasFullWindow) {
    return {
      currentHour,
      sampleCount: samples.length,
      sufficient: false,
      peakHours: [],
      isPeakHour: false,
      isAnomalous: false,
      message: "Sin patrón histórico suficiente.",
    };
  }

  const counts = Array.from({ length: 24 }, () => 0);
  for (const sample of samples) counts[sample.hour] += 1;
  const maximum = Math.max(...counts);
  const peakHours = counts.flatMap((count, hour) =>
    count === maximum && count > 0 ? [hour] : [],
  );
  const isPeakHour = peakHours.includes(currentHour);
  return {
    currentHour,
    sampleCount: samples.length,
    sufficient: true,
    peakHours,
    isPeakHour,
    isAnomalous: !isPeakHour,
    message: isPeakHour
      ? "Hora de saturación conocida del portal. Reintento automático fuera de pico."
      : "Fallo fuera de la hora de saturación habitual; comportamiento anómalo.",
  };
}

export async function getSaturationAnalysis(
  now = new Date(),
): Promise<SaturationAnalysis> {
  const config = getConfig();
  const windowDays = config.SATURATION_WINDOW_DAYS ?? 7;
  const minSamples = config.SATURATION_MIN_SAMPLES ?? 20;
  const histogram = normalizeHistogram(
    await getState<unknown>(STATE_KEYS.NETWORK_FAILURE_HISTOGRAM),
  );
  return analyzeSaturation({
    histogram,
    now,
    windowDays,
    minSamples,
  });
}

export async function recordNetworkFailure(
  now = new Date(),
): Promise<SaturationAnalysis> {
  const previousQueue = histogramMutationQueue;
  let release: () => void = () => undefined;
  histogramMutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previousQueue;
  try {
    const config = getConfig();
    const windowDays = config.SATURATION_WINDOW_DAYS ?? 7;
    const minSamples = config.SATURATION_MIN_SAMPLES ?? 20;
    const current = normalizeHistogram(
      await getState<unknown>(STATE_KEYS.NETWORK_FAILURE_HISTOGRAM),
    );
    const samples = samplesInWindow(
      current,
      now,
      windowDays,
    );
    samples.push({ at: now.toISOString(), hour: mexicoHour(now) });
    const histogram: NetworkFailureHistogram = {
      samples,
      startedAt: current.startedAt ?? now.toISOString(),
    };
    await setStateStrict(STATE_KEYS.NETWORK_FAILURE_HISTOGRAM, histogram);
    return analyzeSaturation({
      histogram,
      now,
      windowDays,
      minSamples,
    });
  } finally {
    release();
  }
}

export function resetHistogramMutationQueueForTests(): void {
  histogramMutationQueue = Promise.resolve();
}
