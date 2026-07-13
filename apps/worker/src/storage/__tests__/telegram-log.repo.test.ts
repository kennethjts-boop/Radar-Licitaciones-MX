const mockInsert = jest.fn().mockResolvedValue({ error: null });

jest.mock("../client", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table !== "telegram_logs") throw new Error(`Tabla inesperada: ${table}`);
      return { insert: mockInsert };
    },
  }),
}));

import { writeTelegramLog } from "../telegram-log.repo";

describe("writeTelegramLog", () => {
  beforeEach(() => jest.clearAllMocks());

  it("escribe telemetría estructurada de sendMessage", async () => {
    await writeTelegramLog({
      command: "sendMessage",
      requestPayload: { parseMode: "HTML", textLength: 42 },
      responsePayload: { messageId: 123 },
      status: "ok",
    });

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      command: "sendMessage",
      request_payload: { parseMode: "HTML", textLength: 42 },
      response_payload: { messageId: 123 },
      status: "ok",
    }));
  });
});
