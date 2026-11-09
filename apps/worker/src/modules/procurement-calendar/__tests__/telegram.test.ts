const getCalendarView = jest.fn();
const enableTracking = jest.fn();
const disableTracking = jest.fn();
jest.mock("../service", () => ({
  CALENDAR_BUTTON_RADAR_KEYS: ["birmex_prioridad_20261108"],
  defaultDeps: {}, getCalendarView: (...a: unknown[]) => getCalendarView(...a),
  enableTracking: (...a: unknown[]) => enableTracking(...a), disableTracking: (...a: unknown[]) => disableTracking(...a),
  isTracking: async () => false,
}));
jest.mock("../store", () => ({ getButtons: jest.fn(async () => null), saveButtons: jest.fn(async () => undefined) }));
const rows: unknown[] = [];
jest.mock("../../../storage/client", () => ({
  getSupabaseClient: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "in", "order"]) chain[m] = () => chain;
    chain.limit = async () => ({ data: rows, error: null });
    return { from: () => chain };
  },
}));
jest.mock("../../../core/logger", () => ({ createModuleLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));
jest.mock("../../../config/env", () => ({ getConfig: () => ({ TELEGRAM_CHAT_ID: "100", TELEGRAM_ADMIN_CHAT_IDS: [] }) }));
jest.mock("../../licitacion-watchdog/consent", () => ({
  isAuthorizedChatUser: (chat: string, user?: number) => chat === "100" && user === 100,
}));

import { attachCalendarButtonsToSentAlerts, handleCalendarCallback, handleCalendarCommand } from "../telegram";

const ID = "cf2458a7-d351-4f07-be07-84ac1da0764e";
const bot = () => ({
  answerCallbackQuery: jest.fn(async () => true), sendMessage: jest.fn(async () => ({})), editMessageReplyMarkup: jest.fn(async () => true),
});
const query = (data: string, user = 100, chat = 100) => ({
  id: "q1", data, from: { id: user }, message: { message_id: 3905, chat: { id: chat } },
}) as never;

describe("botones de calendario en Telegram", () => {
  beforeEach(() => jest.clearAllMocks());

  it("Ver calendario responde con el calendario al mensaje 3905", async () => {
    getCalendarView.mockResolvedValue({ text: "📅 CALENDARIO · LA-12-NEF-012NEF001-N-3-2027\n19/11/2026 10:00", tracking: false, info: { id: ID } });
    const b = bot();
    await handleCalendarCallback(b as never, query(`cal:${ID}`));
    const [chat, text, options] = b.sendMessage.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(chat).toBe("100");
    expect(text).toContain("19/11/2026 10:00");
    expect(options.reply_to_message_id).toBe(3905);
  });

  it("solo usuarios autorizados pueden usar los botones", async () => {
    const b = bot();
    await handleCalendarCallback(b as never, query(`trk:on:${ID}`, 999));
    expect(b.answerCallbackQuery).toHaveBeenCalledWith("q1", { text: "No autorizado" });
    expect(enableTracking).not.toHaveBeenCalled();
  });

  it("Avisarme de cambios activa el seguimiento y cambia el botón; Dejar de avisar lo revierte", async () => {
    enableTracking.mockResolvedValue({ info: { id: ID, expediente: "LA-12-NEF-012NEF001-N-3-2027" }, baselineFrom: "portal" });
    disableTracking.mockResolvedValue({ id: ID, expediente: "LA-12-NEF-012NEF001-N-3-2027" });
    const b = bot();
    await handleCalendarCallback(b as never, query(`trk:on:${ID}`));
    expect(enableTracking).toHaveBeenCalledWith(ID, "100", 100, expect.anything());
    const markupOn = (b.editMessageReplyMarkup.mock.calls[0] as unknown[])[0] as { inline_keyboard: Array<Array<{ callback_data: string }>> };
    expect(markupOn.inline_keyboard[0][1].callback_data).toBe(`trk:off:${ID}`);
    await handleCalendarCallback(b as never, query(`trk:off:${ID}`));
    const markupOff = (b.editMessageReplyMarkup.mock.calls[1] as unknown[])[0] as { inline_keyboard: Array<Array<{ callback_data: string }>> };
    expect(markupOff.inline_keyboard[0][1].callback_data).toBe(`trk:on:${ID}`);
  });

  it("agrega los botones al mensaje 3905 ya enviado", async () => {
    rows.length = 0;
    rows.push({ procurement_id: ID, telegram_message_id: 3905, procurements: { licitation_number: "LA-12-NEF-012NEF001-N-3-2027" } });
    const b = bot();
    expect(await attachCalendarButtonsToSentAlerts(b as never)).toMatchObject({ attached: 1, failed: 0 });
    expect(b.editMessageReplyMarkup).toHaveBeenCalledWith(expect.anything(), { chat_id: "100", message_id: 3905 });
  });

  it("si el mensaje ya no admite botones, ofrece /calendario por número de expediente", async () => {
    rows.length = 0;
    rows.push({ procurement_id: ID, telegram_message_id: 3905, procurements: { licitation_number: "LA-12-NEF-012NEF001-N-3-2027" } });
    const b = bot();
    b.editMessageReplyMarkup.mockRejectedValue(new Error("Bad Request: message can't be edited"));
    expect(await attachCalendarButtonsToSentAlerts(b as never)).toMatchObject({ attached: 0, failed: 1 });
    expect((b.sendMessage.mock.calls[0] as unknown[])[1]).toContain("/calendario LA-12-NEF-012NEF001-N-3-2027");
  });

  it("/calendario <número> responde con el calendario; sin número da el uso", async () => {
    getCalendarView.mockResolvedValue({ text: "CAL", tracking: true, info: { id: ID } });
    const b = bot();
    await handleCalendarCommand(b as never, { chat: { id: 100 }, from: { id: 100 } } as never, "LA-12-NEF-012NEF001-N-3-2027");
    expect(getCalendarView).toHaveBeenCalledWith("LA-12-NEF-012NEF001-N-3-2027", expect.anything());
    await handleCalendarCommand(b as never, { chat: { id: 100 }, from: { id: 100 } } as never, undefined);
    expect((b.sendMessage.mock.calls[1] as unknown[])[1]).toContain("/calendario LA-12");
  });
});
