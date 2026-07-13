import type { SummaryData } from "../../modules/alert-filter";

const mockBuildSummaryData = jest.fn<Promise<SummaryData>, []>();
const mockSendEnhancedDailySummary = jest.fn();
const mockFormatEnhancedDailySummaryMessage = jest.fn((_data: SummaryData) => "RESUMEN RECUPERABLE");
const mockSetState = jest.fn().mockResolvedValue(undefined);
const mockDailyUpsert = jest.fn().mockResolvedValue({ error: null });
const mockAlertInsert = jest.fn().mockResolvedValue({ error: null });
const mockFrom = jest.fn((table: string) => {
  if (table === "daily_summaries") return { upsert: mockDailyUpsert };
  if (table === "alerts") return { insert: mockAlertInsert };
  throw new Error(`Tabla inesperada: ${table}`);
});

jest.mock("../../modules/alert-filter", () => ({
  buildSummaryData: () => mockBuildSummaryData(),
}));
jest.mock("../../alerts/telegram.alerts", () => ({
  sendEnhancedDailySummary: (data: SummaryData) => mockSendEnhancedDailySummary(data),
  formatEnhancedDailySummaryMessage: (data: SummaryData) => mockFormatEnhancedDailySummaryMessage(data),
  describeTelegramSendError: () => ({
    kind: "network",
    retryable: true,
    code: "EFATAL",
    summary: "AggregateError",
  }),
}));
jest.mock("../../storage/client", () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));
jest.mock("../../core/system-state", () => ({
  setState: (...args: unknown[]) => mockSetState(...args),
  STATE_KEYS: { LAST_DAILY_SUMMARY: "last_daily_summary" },
}));
jest.mock("../../core/healthcheck", () => ({
  healthTracker: { getStatus: () => ({ services: { database: "ok" } }) },
}));

import { runDailySummaryJob } from "../daily-summary.job";

const summary: SummaryData = {
  summaryDate: "2026-07-13",
  newActive: [],
  recentDesierta: [],
  soonExpiring: [],
  highScore: [],
  totalSeen: 165,
  totalNew: 1,
  totalAlerts: 0,
  excludedCount: 12,
  technicalIncidents: [],
};

describe("runDailySummaryJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildSummaryData.mockResolvedValue({ ...summary, technicalIncidents: [] });
    mockSendEnhancedDailySummary.mockRejectedValue(Object.assign(new Error("EFATAL"), { code: "EFATAL" }));
    mockDailyUpsert.mockResolvedValue({ error: null });
    mockAlertInsert.mockResolvedValue({ error: null });
  });

  it("persiste el mensaje fallido y termina ok cuando Telegram falla", async () => {
    await expect(runDailySummaryJob()).resolves.toBeUndefined();

    expect(mockDailyUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ summary_text: expect.any(String) }),
      { onConflict: "summary_date" },
    );
    expect(mockAlertInsert).toHaveBeenCalledWith(expect.objectContaining({
      alert_type: "daily_summary",
      telegram_status: "failed",
      telegram_message: "RESUMEN RECUPERABLE",
    }));
    expect(mockSetState).toHaveBeenLastCalledWith("last_daily_summary", expect.objectContaining({
      status: "ok",
      summaryGenerated: true,
      summaryPersisted: true,
      telegramDeliveryStatus: "failed",
      failedAlertPersisted: true,
    }));
  });
});
