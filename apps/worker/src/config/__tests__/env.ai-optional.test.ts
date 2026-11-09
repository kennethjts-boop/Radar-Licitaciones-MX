/** Escaneo y alertas no dependen de la IA: una clave ausente, vacía o de relleno no debe impedir el arranque. */
describe("configuración sin IA", () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; jest.resetModules(); });

  async function load(): Promise<ReturnType<typeof import("../env")["getConfig"]>> {
    jest.resetModules();
    const { getConfig } = await import("../env");
    return getConfig();
  }

  it.each([["ausente", undefined], ["vacía", ""], ["espacios", "   "], ["relleno corto", "sk-x"]])(
    "OPENAI_API_KEY %s: el worker arranca y la IA queda deshabilitada", async (_label, value) => {
      if (value === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = value;
      process.env.OPENROUTER_API_KEY = "";
      const config = await load();
      expect(config.OPENAI_API_KEY).toBeUndefined();
      expect(config.OPENROUTER_API_KEY).toBeUndefined();
      expect(config.TELEGRAM_CHAT_ID).toBe("-100000000");
    });

  it("una clave válida se conserva", async () => {
    process.env.OPENAI_API_KEY = "sk-test-0123456789abcdef";
    expect((await load()).OPENAI_API_KEY).toBe("sk-test-0123456789abcdef");
  });
});
