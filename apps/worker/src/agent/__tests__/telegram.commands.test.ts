import { initCommandBot, isManualScanOkStatus } from "../telegram.commands";
import TelegramBot from "node-telegram-bot-api";
import { getConfig } from "../../config/env";

let mockExternalState: Record<string, unknown> | null = null;
let mockTelegramCommandsState: Record<string, unknown> | null = null;

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
jest.mock("../../config/env", () => {
  const config = {
    TELEGRAM_BOT_TOKEN: "mock_token",
    TELEGRAM_CHAT_ID: "123456",
    TELEGRAM_COMMAND_BOT_ENABLED: true,
    TELEGRAM_COMMANDS_ENABLED: true,
    TELEGRAM_POLLING_ENABLED: true,
    COLLECT_INTERVAL_MINUTES: 30,
    NODE_ENV: "test",
    RAILWAY_ENVIRONMENT: "local",
    COMMERCIAL_MATCHING_ENABLED: true,
    ENABLE_EXTERNAL_LEADS_OSINT: true,
    EXTERNAL_LEADS_DRY_RUN: false,
    EXTERNAL_LEADS_DISCOVERY_MODE: true,
    LOG_LEVEL: "info",
  };
  return {
    getConfig: jest.fn(() => config),
  };
});

// Mock system state
jest.mock("../../core/system-state", () => ({
  getState: jest.fn(async (key: string) => {
    if (key === "last_external_leads_run") return mockExternalState;
    if (key === "telegram_commands_telemetry") {
      return mockTelegramCommandsState ?? {
        telegram_polling_ok: true,
        telegram_send_message_ok: true,
        telegram_commands_consecutive_failures: 0,
      };
    }
    return null;
  }),
  setState: jest.fn().mockResolvedValue(undefined),
  STATE_KEYS: {
    LAST_COLLECT_RUN: "last_collect_run",
    LAST_EXTERNAL_LEADS_RUN: "last_external_leads_run",
    TELEGRAM_COMMANDS_TELEMETRY: "telegram_commands_telemetry",
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
      lastCycleAt: null,
      lastCycleStatus: "success",
      uptimeMs: 60_000,
      schedulerStatus: "active",
      externalLeads: { status: "none" },
    }),
    setTelegramHealth: jest.fn(),
  },
}));

jest.mock("../../storage/collect-run.repo", () => ({
  getLastCollectRun: jest.fn().mockResolvedValue(null),
}));

jest.mock("../../storage/match-alert.repo", () => ({
  getLastSentAlert: jest.fn().mockResolvedValue(null),
}));

describe("Telegram Commands - /noticias_comerciales", () => {
  let botInstance: TelegramBot;
  const mockSendMessage = jest.fn().mockResolvedValue({ message_id: 111 });
  const mockConfig = getConfig() as ReturnType<typeof getConfig> & {
    ENABLE_EXTERNAL_LEADS_OSINT: boolean;
    EXTERNAL_LEADS_DISCOVERY_MODE: boolean;
  };

  beforeAll(async () => {
    // Override prototype methods on TelegramBot mock to avoid real API calls
    jest.spyOn(TelegramBot.prototype, "deleteWebHook").mockResolvedValue(true);
    jest.spyOn(TelegramBot.prototype, "sendMessage").mockImplementation(mockSendMessage);
    jest.spyOn(TelegramBot.prototype, "startPolling").mockImplementation(jest.fn());

    botInstance = await initCommandBot();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.ENABLE_EXTERNAL_LEADS_OSINT = true;
    mockConfig.EXTERNAL_LEADS_DISCOVERY_MODE = true;
    mockExternalState = null;
    mockTelegramCommandsState = null;
  });

  it("/estado muestra External OSINT deshabilitado y contadores actuales en cero", async () => {
    mockConfig.ENABLE_EXTERNAL_LEADS_OSINT = false;
    mockExternalState = {
      status: "error",
      sourcesReviewed: 40,
      rawResultsReceived: 386,
      detected: 12,
      errors: ["certificate error"],
    };

    const callbacks = (botInstance as any)._textRegexpCallbacks || [];
    const handler = callbacks.find(
      (callback: any) =>
        callback.regexp?.toString().includes("prueba|estado"),
    )?.callback;
    expect(handler).toBeDefined();

    await handler({
      chat: { id: 123456 },
      text: "/estado",
    });

    const message = mockSendMessage.mock.calls.at(-1)?.[1] as string;
    expect(message).toContain("External OSINT: <b>deshabilitado</b>");
    expect(message).toContain("Discovery: <b>false</b>");
    expect(message).toContain("Último: <b>disabled_by_env</b>");
    expect(message).toContain("Fuentes: <b>0</b> | Raw: <b>0</b>");
    expect(message).not.toContain("certificate error");
    expect(message).not.toContain("Discovery: <b>true</b>");
  });

  it("/estado separa sendMessage de polling y muestra fallos/recovery", async () => {
    mockTelegramCommandsState = {
      telegram_polling_ok: false,
      telegram_send_message_ok: true,
      telegram_commands_consecutive_failures: 3,
      last_telegram_commands_error_at: "2026-06-10T00:02:00.000Z",
      last_telegram_commands_error_reason: "transient_network",
      last_telegram_commands_recovery_at: "2026-06-10T00:10:00.000Z",
      recent_telegram_polling_failures: [
        {
          at: "2026-06-10T00:02:00.000Z",
          kind: "transient_network",
          code: "ETIMEDOUT",
          technicalReason: "code=ETIMEDOUT; error=socket timeout",
        },
      ],
    };

    const callbacks = (botInstance as any)._textRegexpCallbacks || [];
    const handler = callbacks.find(
      (callback: any) =>
        callback.regexp?.toString().includes("prueba|estado"),
    )?.callback;
    expect(handler).toBeDefined();

    await handler({
      chat: { id: 123456 },
      text: "/estado",
    });

    const message = mockSendMessage.mock.calls.at(-1)?.[1] as string;
    expect(message).toContain("Telegram alertas sendMessage: <b>OK</b>");
    expect(message).toContain("Telegram commands polling: <b>DEGRADADO</b>");
    expect(message).toContain("Últimos fallos polling:");
    expect(message).toContain("transient_network");
    expect(message).toContain("ETIMEDOUT");
    expect(message).toContain("Último recovery:");
    expect(message).toContain("No afecta ComprasMX ni matches");
  });

  it("/debug_resumen oculta errores y descartes históricos si OSINT está disabled", async () => {
    mockConfig.ENABLE_EXTERNAL_LEADS_OSINT = false;
    mockExternalState = {
      status: "error",
      sourcesReviewed: 40,
      rawResultsReceived: 386,
      errors: ["certificate error"],
      topErrors: [{ message: "certificate error" }],
      topDiscardedCandidates: [{ title: "old candidate" }],
    };

    const callbacks = (botInstance as any)._textRegexpCallbacks || [];
    const handler = callbacks.find(
      (callback: any) =>
        callback.regexp?.toString().includes("debug_resumen"),
    )?.callback;
    expect(handler).toBeDefined();

    await handler({
      chat: { id: 123456 },
      text: "/debug_resumen",
    });

    const message = mockSendMessage.mock.calls.at(-1)?.[1] as string;
    expect(message).toContain(
      "External OSINT:</b> deshabilitado por configuración",
    );
    expect(message).toContain("Discovery mode: <b>false</b>");
    expect(message).toContain("Fuentes revisadas: <b>0</b>");
    expect(message).toContain("Resultados crudos: <b>0</b>");
    expect(message).toContain("Errores: <b>0</b>");
    expect(message).not.toContain("certificate error");
    expect(message).not.toContain("old candidate");
    expect(message).not.toContain("Top errores");
  });

  it("/scan trata empty_result como ejecución correcta", () => {
    expect(isManualScanOkStatus("success")).toBe(true);
    expect(isManualScanOkStatus("empty_result")).toBe(true);
    expect(isManualScanOkStatus("degraded")).toBe(false);
    expect(isManualScanOkStatus("error")).toBe(false);
  });

  it("/noticias_comerciales no consulta fuentes guardadas si OSINT está disabled", async () => {
    mockConfig.ENABLE_EXTERNAL_LEADS_OSINT = false;

    const callbacks = (botInstance as any)._textRegexpCallbacks || [];
    const matchObj = callbacks.find(
      (callback: any) =>
        callback.regexp?.toString().includes("noticias_comerciales"),
    );
    expect(matchObj).toBeDefined();

    await matchObj.callback(
      {
        chat: { id: 123456 },
        text: "/noticias_comerciales",
      },
      ["/noticias_comerciales", undefined],
    );

    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(
      "123456",
      "🧭 External OSINT está deshabilitado por configuración.",
      expect.objectContaining({ parse_mode: "HTML" }),
    );
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
