import type TelegramBot from "node-telegram-bot-api";
import { requestWatchdogConsent, handleWatchdogConsentCallback, handleWatchdogConsentReply, activateApprovedConsent } from "../consent";
import { getWatchdogConsent, createWatchdogConsent, updatePendingConsent, consentForReply, WatchdogConsent } from "../consent-store";
import { activateWatchdogTarget, listPersistentTargets } from "../target-manager";
import { getCommandBot } from "../../../agent/telegram.commands";

jest.mock("../../../agent/telegram.commands", () => ({ getCommandBot: jest.fn() }));
jest.mock("../../../config/env", () => ({ getConfig: () => ({ LOG_LEVEL: "silent", TELEGRAM_CHAT_ID: "123", TELEGRAM_ADMIN_CHAT_IDS: "" }) }));
jest.mock("../consent-store", () => ({ getWatchdogConsent: jest.fn(), createWatchdogConsent: jest.fn(), updatePendingConsent: jest.fn(), consentForReply: jest.fn() }));
jest.mock("../target-manager", () => ({ activateWatchdogTarget: jest.fn(), listPersistentTargets: jest.fn() }));

const pending: WatchdogConsent = { procurementId: "proc-1", label: "IMSS · N-200", chatId: "123", status: "pending", messageId: 42 };
const sendMessage = jest.fn();
const answerCallbackQuery = jest.fn();
const bot = { sendMessage, answerCallbackQuery, editMessageReplyMarkup: jest.fn().mockResolvedValue(true) } as unknown as TelegramBot;
function callback(yes = true, userId = 123, messageId = 42): TelegramBot.CallbackQuery {
  return { id: "callback-1", from: { id: userId }, data: `wd:${yes ? "yes" : "no"}:proc-1`, message: { message_id: messageId, chat: { id: 123 } } } as TelegramBot.CallbackQuery;
}

describe("consentimiento watchdog en Telegram", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendMessage.mockResolvedValue({ message_id: 42 });
    answerCallbackQuery.mockResolvedValue(true);
    (getCommandBot as jest.Mock).mockReturnValue(bot);
    (getWatchdogConsent as jest.Mock).mockResolvedValue({ ...pending });
    (updatePendingConsent as jest.Mock).mockResolvedValue(true);
    (listPersistentTargets as jest.Mock).mockResolvedValue([]);
    (activateWatchdogTarget as jest.Mock).mockResolvedValue({ active: true });
  });

  it("envía botones y persiste la pregunta sin iniciar vigilancia; llamadas concurrentes no duplican", async () => {
    (getWatchdogConsent as jest.Mock).mockResolvedValue({ ...pending, messageId: undefined });
    await Promise.all([requestWatchdogConsent("proc-1", pending.label), requestWatchdogConsent("proc-1", pending.label)]);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][2].reply_markup.inline_keyboard[0]).toHaveLength(2);
    expect(updatePendingConsent).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", messageId: 42 }));
    expect(activateWatchdogTarget).not.toHaveBeenCalled();
  });

  it("no repite preguntas pendientes ni rechazadas, incluso después de reiniciar", async () => {
    await requestWatchdogConsent("proc-1", pending.label);
    (getWatchdogConsent as jest.Mock).mockResolvedValue({ ...pending, status: "declined" });
    await requestWatchdogConsent("proc-1", pending.label);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(activateWatchdogTarget).not.toHaveBeenCalled();
  });

  it("el Sí persiste antes de activar y el No nunca activa", async () => {
    await handleWatchdogConsentCallback(bot, callback());
    expect(updatePendingConsent).toHaveBeenCalledWith(expect.objectContaining({ status: "approved", decidedBy: 123 }));
    expect(activateWatchdogTarget).toHaveBeenCalledWith("proc-1");
    expect((updatePendingConsent as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan((activateWatchdogTarget as jest.Mock).mock.invocationCallOrder[0]);
    (activateWatchdogTarget as jest.Mock).mockClear();
    await handleWatchdogConsentCallback(bot, callback(false));
    expect(updatePendingConsent).toHaveBeenLastCalledWith(expect.objectContaining({ status: "declined" }));
    expect(activateWatchdogTarget).not.toHaveBeenCalled();
  });

  it("rechaza usuarios ajenos y botones de otro mensaje", async () => {
    await handleWatchdogConsentCallback(bot, callback(true, 999));
    await handleWatchdogConsentCallback(bot, callback(true, 123, 999));
    expect(updatePendingConsent).not.toHaveBeenCalled();
    expect(activateWatchdogTarget).not.toHaveBeenCalled();
  });

  it("responder sí al mensaje correcto también autoriza; un sí suelto no", async () => {
    (consentForReply as jest.Mock).mockResolvedValue(pending);
    const msg = { text: "SÍ", from: { id: 123 }, chat: { id: 123 }, reply_to_message: { message_id: 42 } } as TelegramBot.Message;
    await handleWatchdogConsentReply(bot, msg);
    expect(activateWatchdogTarget).toHaveBeenCalledWith("proc-1");
    (activateWatchdogTarget as jest.Mock).mockClear();
    await handleWatchdogConsentReply(bot, { ...msg, reply_to_message: undefined });
    expect(activateWatchdogTarget).not.toHaveBeenCalled();
  });

  it("no activa si guardar la respuesta falla o si otra respuesta ganó", async () => {
    (updatePendingConsent as jest.Mock).mockRejectedValueOnce(new Error("DB down"));
    await handleWatchdogConsentCallback(bot, callback());
    (updatePendingConsent as jest.Mock).mockResolvedValueOnce(false);
    await handleWatchdogConsentCallback(bot, callback());
    expect(activateWatchdogTarget).not.toHaveBeenCalled();
  });

  it("un botón viejo no reactiva después de /novigilar", async () => {
    (listPersistentTargets as jest.Mock).mockResolvedValue([{ procurementId: "proc-1", active: false, deactivatedAt: "2026-10-23T12:00:00Z" }]);
    expect(await activateApprovedConsent({ ...pending, status: "approved", decidedAt: "2026-10-23T11:00:00Z" })).toBe(false);
    expect(activateWatchdogTarget).not.toHaveBeenCalled();
  });

  it("sin bot disponible no crea ni activa; permite reintento posterior", async () => {
    (getCommandBot as jest.Mock).mockReturnValue(null);
    expect(await requestWatchdogConsent("proc-1", pending.label)).toBe(false);
    expect(createWatchdogConsent).not.toHaveBeenCalled();
    expect(activateWatchdogTarget).not.toHaveBeenCalled();
  });
});
