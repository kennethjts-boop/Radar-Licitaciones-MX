import { initCommandBot } from "../telegram.commands";
import TelegramBot from "node-telegram-bot-api";

// Mock Supabase
const mockSelect = jest.fn();
const mockOrder = jest.fn().mockReturnValue({ limit: () => Promise.resolve({ data: [], error: null }) });
const mockFrom = jest.fn().mockReturnValue({ select: () => ({ order: mockOrder }) });
const mockSupabaseClient = {
  from: mockFrom,
};

jest.mock("../../storage/client", () => ({
  getSupabaseClient: () => mockSupabaseClient,
}));

// Mock config
jest.mock("../../config/env", () => ({
  getConfig: () => ({
    TELEGRAM_BOT_TOKEN: "mock_token",
    TELEGRAM_CHAT_ID: "123456",
    COLLECT_INTERVAL_MINUTES: 30,
    NODE_ENV: "test",
    RAILWAY_ENVIRONMENT: "local",
    COMMERCIAL_MATCHING_ENABLED: true,
    ENABLE_EXTERNAL_LEADS_OSINT: true,
    EXTERNAL_LEADS_DRY_RUN: false,
    EXTERNAL_LEADS_DISCOVERY_MODE: true,
    LOG_LEVEL: "info",
  }),
}));

// Mock system state
jest.mock("../../core/system-state", () => ({
  getState: jest.fn().mockResolvedValue(null),
  STATE_KEYS: {
    LAST_COLLECT_RUN: "last_collect_run",
    LAST_EXTERNAL_LEADS_RUN: "last_external_leads_run",
    WORKER_BOOT_TIME: "worker_boot_time",
    SCHEDULER_STATUS: "scheduler_status",
    LAST_HEALTHCHECK_AT: "last_healthcheck_at",
    LAST_DAILY_SUMMARY: "last_daily_summary",
  },
}));

// Mock healthTracker
jest.mock("../../core/healthcheck", () => ({
  healthTracker: {
    getStatus: () => ({
      overall: "ok",
      services: {
        database: "ok",
        telegram: "ok",
        playwright: "ok",
      },
      dbConnected: true,
      dbSchemaValid: true,
      degradationReasons: [],
      externalLeads: { status: "none" },
    }),
  },
}));

describe("Telegram Commands - /noticias_comerciales", () => {
  let botInstance: TelegramBot;
  const mockSendMessage = jest.fn().mockResolvedValue({ message_id: 111 });

  beforeAll(async () => {
    // Override prototype methods on TelegramBot mock to avoid real API calls
    jest.spyOn(TelegramBot.prototype, "deleteWebHook").mockResolvedValue(true);
    jest.spyOn(TelegramBot.prototype, "sendMessage").mockImplementation(mockSendMessage);
    jest.spyOn(TelegramBot.prototype, "startPolling").mockImplementation(jest.fn());

    botInstance = await initCommandBot();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("responde cuando no hay noticias comerciales útiles", async () => {
    // Mock Supabase returning no data
    mockOrder.mockReturnValue({
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    });

    // Simulate sending /noticias_comerciales to the bot
    const callbacks = (botInstance as any)._textRegexpCallbacks || [];
    const matchObj = callbacks.find((c: any) => c.regexp && c.regexp.toString().includes("noticias_comerciales"));
    expect(matchObj).toBeDefined();
    const matchHandler = matchObj.callback;

    const msg = {
      chat: { id: 123456 },
      text: "/noticias_comerciales",
    };

    await matchHandler(msg, ["/noticias_comerciales", undefined]);

    expect(mockSendMessage).toHaveBeenCalledWith(
      "123456",
      "No hay noticias comerciales útiles por ahora. External OSINT está activo y revisando fuentes.",
      expect.objectContaining({ parse_mode: "HTML" })
    );
  });

  it("responde y formatea correctamente cuando hay resultados", async () => {
    // Mock Supabase returning a valid lead
    const mockLead = {
      id: "abc",
      title: "Adquisición de aceites lubricantes y anticongelantes para parque vehicular en Guadalajara",
      source_name: "Datos Gob MX",
      source_url: "https://datos.gob.mx/lead",
      state: "Jalisco",
      estimated_interest_score: 85,
      is_official_source: true,
      source_published_at: new Date().toISOString(),
      detected_at: new Date().toISOString(),
      raw_json: {
        sourceType: "datos_gob_mx",
        referenceCompany: "HM HIGHMIL",
        commercialProfileId: "hm_highmil_lubricants",
        scoreReasons: ["official_procurement_signal", "public_tender_evidence"],
      },
    };

    mockOrder.mockReturnValue({
      limit: jest.fn().mockResolvedValue({ data: [mockLead], error: null }),
    });

    const callbacks = (botInstance as any)._textRegexpCallbacks || [];
    const matchObj = callbacks.find((c: any) => c.regexp && c.regexp.toString().includes("noticias_comerciales"));
    expect(matchObj).toBeDefined();
    const matchHandler = matchObj.callback;

    const msg = {
      chat: { id: 123456 },
      text: "/noticias_comerciales",
    };

    await matchHandler(msg, ["/noticias_comerciales", undefined]);

    expect(mockSendMessage).toHaveBeenCalledWith(
      "123456",
      expect.stringContaining("SEÑALES Y NOTICIAS COMERCIALES RECIENTES"),
      expect.any(Object)
    );
    expect(mockSendMessage).toHaveBeenCalledWith(
      "123456",
      expect.stringContaining("Adquisición de aceites lubricantes"),
      expect.any(Object)
    );
    expect(mockSendMessage).toHaveBeenCalledWith(
      "123456",
      expect.stringContaining("HM HIGHMIL"),
      expect.any(Object)
    );
  });

  it("redacta PII (emails/telefonos) de los titulos", async () => {
    const mockLead = {
      id: "def",
      title: "Contacto juan@gmail.com cel 5512345678 compra de papeleria institucional",
      source_name: "Official Website",
      source_url: "https://gob.mx/convocatoria",
      state: "CDMX",
      estimated_interest_score: 90,
      is_official_source: true,
      source_published_at: new Date().toISOString(),
      detected_at: new Date().toISOString(),
      raw_json: {
        sourceType: "official_website",
        referenceCompany: "PRIMASA",
        commercialProfileId: "primasa_printing",
        scoreReasons: ["public_tender_evidence"],
      },
    };

    mockOrder.mockReturnValue({
      limit: jest.fn().mockResolvedValue({ data: [mockLead], error: null }),
    });

    const callbacks = (botInstance as any)._textRegexpCallbacks || [];
    const matchObj = callbacks.find((c: any) => c.regexp && c.regexp.toString().includes("noticias_comerciales"));
    expect(matchObj).toBeDefined();
    const matchHandler = matchObj.callback;

    const msg = {
      chat: { id: 123456 },
      text: "/noticias_comerciales 5",
    };

    await matchHandler(msg, ["/noticias_comerciales 5", "5"]);

    expect(mockSendMessage).toHaveBeenCalled();
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).not.toContain("juan@gmail.com");
    expect(sentText).not.toContain("5512345678");
    expect(sentText).toContain("[REDACTED_EMAIL]");
    expect(sentText).toContain("[REDACTED_PHONE]");
  });
});
