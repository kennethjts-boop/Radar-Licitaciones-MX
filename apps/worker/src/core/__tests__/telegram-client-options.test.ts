import {
  TELEGRAM_HTTP_REQUEST_TIMEOUT_MS,
  telegramBotConstructorOptions,
} from "../telegram-client-options";

describe("telegramBotConstructorOptions", () => {
  it("configura timeout HTTP real de 20 segundos", () => {
    const options = telegramBotConstructorOptions();

    expect(TELEGRAM_HTTP_REQUEST_TIMEOUT_MS).toBe(20_000);
    expect(options).toMatchObject({
      polling: false,
      request: { timeout: 20_000 },
    });
  });
});
