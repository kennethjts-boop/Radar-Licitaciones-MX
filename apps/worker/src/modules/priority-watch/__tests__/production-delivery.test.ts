const sendMessage = jest.fn();
jest.mock("../../../agent/telegram.commands", () => ({ getCommandBot: () => ({ sendMessage }) }));
jest.mock("../../../storage/client", () => ({ getSupabaseClient: jest.fn() }));
jest.mock("../../../core/logger", () => ({ createModuleLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { productionDeps } from "../job";
import { classifySendFailure } from "../outbox";
import type { OutboxEntry } from "../types";

beforeEach(() => sendMessage.mockReset());

it("el adaptador real conserva botones y entrega el recibo con un solo intento", async () => {
  sendMessage.mockResolvedValue({ message_id: 42, chat: { id: -100000000, type: "supergroup" } });
  const id = await productionDeps().send({} as OutboxEntry, "acta", "https://example.com/expediente", "proc-id");
  expect(id).toBe(42);
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(sendMessage.mock.calls[0][2].reply_markup.inline_keyboard[0]).toEqual([
    { text: "📅 Ver calendario", callback_data: "cal:proc-id" },
    { text: "🔗 Abrir expediente", url: "https://example.com/expediente" },
  ]);
});

it.each([
  [Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }), "uncertain"],
  [Object.assign(new Error("HTML inválido"), { code: "ETELEGRAM", response: { statusCode: 400, body: { error_code: 400, description: "can't parse entities" } } }), "definitive"],
])("el adaptador entrega el error original a la bandeja sin reintentos internos: %s", async (error, classification) => {
  sendMessage.mockRejectedValue(error);
  await expect(productionDeps().send({} as OutboxEntry, "acta", null, null)).rejects.toBe(error);
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(classifySendFailure(error)).toBe(classification);
});
