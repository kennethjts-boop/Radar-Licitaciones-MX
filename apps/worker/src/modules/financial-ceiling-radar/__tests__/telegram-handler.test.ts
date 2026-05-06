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

  it("debe manejar fallos internos del análisis con mensaje fallback", async () => {
    const analyzer = require("../analyzer");
    jest.spyOn(analyzer, "analyzeFinancialCeiling").mockRejectedValue(new Error("Timeout de fuente externa"));

    await handleTechoCommand(mockBot, chatId, "LA-TIMEOUT-TEST");
    
    expect(mockSendMessage).toHaveBeenCalledWith(
      chatId,
      expect.stringContaining("No pude estimar el techo financiero"),
      expect.any(Object)
    );
    expect(mockSendMessage).toHaveBeenCalledWith(
      chatId,
      expect.stringContaining("Error interno"),
      expect.any(Object)
    );
  });

  it("debe mostrar 'no determinado' con warnings si no hay datos suficientes", async () => {
    const analyzer = require("../analyzer");
    jest.spyOn(analyzer, "analyzeFinancialCeiling").mockResolvedValue({
      financialCeiling: { type: "no_determinado", confidence: "BAJA", amount: null },
      sourcesConsulted: [{ document: "PNT", status: "not_found" }],
      warnings: ["Sin coincidencias exactas"]
    } as any);

    await handleTechoCommand(mockBot, chatId, "LIC-SIN-DATOS");
    
    expect(mockSendMessage).toHaveBeenCalledWith(
      chatId,
      expect.stringContaining("No pude estimar un techo financiero confiable"),
      expect.any(Object)
    );
  });
});
