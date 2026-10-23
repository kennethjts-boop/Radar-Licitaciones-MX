const state = new Map<string, any>();
const bot = { sendMessage: jest.fn(), editMessageReplyMarkup: jest.fn(), on: jest.fn() };
const httpGet = jest.fn();
jest.mock("axios", () => ({ __esModule: true, default: { get: (...args: any[]) => httpGet(...args) } }));
jest.mock("../../../storage/client", () => ({ getSupabaseClient: () => ({ from: () => ({
  select: () => ({ eq: (_: string, key: string) => ({ maybeSingle: async () => ({ data: state.has(key) ? { value_json: structuredClone(state.get(key)) } : null, error: null }) }),
    like: async () => ({ data: [...state].filter(([key]) => key.startsWith("edomex_notice:")).map(([key, value_json]) => ({ key, value_json: structuredClone(value_json) })), error: null }) }),
  upsert: async (row: any) => { state.set(row.key, structuredClone(row.value_json)); return { error: null }; },
}) }) }));
jest.mock("../../../agent/telegram.commands", () => ({ getCommandBot: () => bot }));
jest.mock("../../../config/env", () => ({ getConfig: () => ({ TELEGRAM_CHAT_ID: "123", TELEGRAM_ADMIN_CHAT_IDS: "999" }) }));
jest.mock("../../../core/lock", () => ({ withDistributedLock: async (_: string, __: string, fn: () => Promise<any>) => fn() }));
jest.mock("../../../core/logger", () => ({ createModuleLogger: () => ({ warn: jest.fn(), info: jest.fn() }) }));

import { runEdomexJob, decideEdomexConsent } from "../job";

function page(count: number): string {
  return `<table>${Array.from({ length: count }, (_, i) => `<tr><td>LPN/ISSEMYM/${i}/2026^/sites/default/files/a${i}.pdf</td><td>ISSEMYM^Adquisición de papelería</td></tr>`).join("")}</table>`;
}
let rowCount = 3;
let pdfBody = "%PDF-1.4 first";
beforeEach(() => {
  state.clear(); jest.clearAllMocks(); rowCount = 3; pdfBody = "%PDF-1.4 first";
  bot.sendMessage.mockResolvedValue({ message_id: 77 });
  bot.editMessageReplyMarkup.mockResolvedValue({});
  httpGet.mockImplementation(async (url: string) => ({ data: url.endsWith(".pdf") ? Buffer.from(pdfBody) : page(rowCount) }));
});

async function discover() {
  await runEdomexJob();
  rowCount = 4;
  await runEdomexJob();
  return [...state.values()].find(value => value.id);
}

it("crea línea base silenciosa; notifica sólo adiciones y no descarga sin sí", async () => {
  await runEdomexJob();
  expect(bot.sendMessage).not.toHaveBeenCalled();
  rowCount = 4; await runEdomexJob(); await runEdomexJob();
  expect(bot.sendMessage).toHaveBeenCalledTimes(1);
  expect(httpGet.mock.calls.some(([url]) => url.endsWith(".pdf"))).toBe(false);
});

it("valida propietario y mensaje; persiste el sí y vigila cambios del PDF", async () => {
  const entry = await discover();
  expect(await decideEdomexConsent(entry.id, "123", 666, 77, "yes", bot as any)).toBe("No autorizado");
  expect(await decideEdomexConsent(entry.id, "123", 123, 88, "yes", bot as any)).toBe("Solicitud no válida");
  await decideEdomexConsent(entry.id, "123", 123, 77, "yes", bot as any);
  await runEdomexJob(); // Línea base de PDF únicamente después del sí.
  expect(bot.sendMessage).toHaveBeenCalledTimes(1);
  pdfBody = "%PDF-1.4 changed"; await runEdomexJob();
  expect(bot.sendMessage).toHaveBeenCalledTimes(2);
  await decideEdomexConsent(entry.id, "123", 123, 77, "stop", bot as any);
  httpGet.mockClear(); await runEdomexJob();
  expect(httpGet.mock.calls.some(([url]) => url.endsWith(".pdf"))).toBe(false);
});

it("el no y el modo watchdog_only impiden altas nuevas", async () => {
  const entry = await discover();
  await decideEdomexConsent(entry.id, "123", 123, 77, "no", bot as any);
  expect(await decideEdomexConsent(entry.id, "123", 123, 77, "yes", bot as any)).toBe("Esta solicitud ya fue respondida");
  httpGet.mockClear(); await runEdomexJob({ discover: false });
  expect(httpGet).not.toHaveBeenCalled();
});
