import { handleTechoCommand } from "../telegram-handler";
import TelegramBot from "node-telegram-bot-api";

// Mock del bot
const mockSendMessage = jest.fn().mockResolvedValue({ message_id: 123 });
const mockBot = {
  sendMessage: mockSendMessage
} as unknown as TelegramBot;

const chatId = "123456";

describe("handleTechoCommand", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ENABLE_FINANCIAL_CEILING_COMMAND;
  });

  it("debe pedir más de 3 caracteres si la query es corta", async () => {
    await handleTechoCommand(mockBot, chatId, "la");
    expect(mockSendMessage).toHaveBeenCalledWith(
      chatId,
      expect.stringContaining("Uso:"),
      expect.any(Object)
    );
  });

  it("debe informar si el comando está deshabilitado", async () => {
    process.env.ENABLE_FINANCIAL_CEILING_COMMAND = "false";
    await handleTechoCommand(mockBot, chatId, "LA-050GYR019-E11-2026");
    expect(mockSendMessage).toHaveBeenCalledWith(
      chatId,
      expect.stringContaining("deshabilitado")
    );
  });

  it("debe enviar mensaje de inicio antes de analizar", async () => {
    // Mock de analyze para que no falle
    const analyzer = require("../analyzer");
    jest.spyOn(analyzer, "analyzeFinancialCeiling").mockResolvedValue({
      financialCeiling: { type: "confirmado", confidence: "ALTA", amount: 100 },
      sourcesConsulted: [],
      warnings: []
    } as any);

    await handleTechoCommand(mockBot, chatId, "LA-050GYR019-E11-2026");
    
    expect(mockSendMessage).toHaveBeenCalledWith(
      chatId,
      expect.stringContaining("Analizando techo financiero"),
      expect.any(Object)
    );
  });
});
