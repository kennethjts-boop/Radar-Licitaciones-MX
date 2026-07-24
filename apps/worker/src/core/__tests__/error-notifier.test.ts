import {
  handlePinoEntry,
  registerErrorNotifier,
} from "../error-notifier";

describe("error notifier suppression", () => {
  it("no duplica en Telegram un error gestionado explícitamente", () => {
    const send = jest.fn();
    registerErrorNotifier(send);

    handlePinoEntry(JSON.stringify({
      level: 50,
      module: "collector-comprasmx",
      msg: "Error técnico persistente en scraper ComprasMX",
      suppressTelegram: true,
      err: { message: "Botón Buscar no encontrado" },
    }));

    expect(send).not.toHaveBeenCalled();
  });

  it("mantiene alertas globales para errores no gestionados", () => {
    const send = jest.fn();
    registerErrorNotifier(send);

    handlePinoEntry(JSON.stringify({
      level: 50,
      module: "unhandled-module",
      msg: "Fallo no gestionado único para test",
      err: { message: "boom notifier test" },
    }));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("[ERROR] unhandled-module");
    expect(send.mock.calls[0][0]).toContain("🎯 VEREDICTO:");
    expect(send.mock.calls[0][0]).toContain("🎮 COMANDOS");
  });
});
