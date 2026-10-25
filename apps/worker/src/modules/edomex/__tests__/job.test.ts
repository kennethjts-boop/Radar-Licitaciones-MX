const state = new Map<string, any>();
const procurements = new Map<string, { id: string; source_url: string; procedure_number: string; raw: any }>();
const bot = { sendMessage: jest.fn(), editMessageReplyMarkup: jest.fn() };
const httpGet = jest.fn();
const upsertMatch = jest.fn();
const ensurePendingNewTenderAlert = jest.fn();
const deliver = jest.fn();

jest.mock("axios", () => ({ __esModule: true, default: { get: (...args: any[]) => httpGet(...args) } }));
jest.mock("../../../storage/client", () => ({ getSupabaseClient: () => ({ from: (table: string) => {
  if (table === "sources") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "src-secogem" }, error: null }) }) }) };
  if (table === "radars") return { select: () => ({ in: async (_: string, keys: string[]) => ({ data: keys.map((key) => ({ id: `db-${key}`, key, is_active: true })), error: null }) }) };
  if (table === "procurements") return { select: () => ({ eq: (_: string, id: string) => ({ maybeSingle: async () => {
    const p = [...procurements.values()].find((x) => x.id === id);
    return { data: p ? { id: p.id, source_url: p.source_url, procedure_number: p.procedure_number, raw_items: { raw_json: p.raw } } : null, error: null };
  } }) }) };
  return {
    select: () => ({ eq: (_: string, key: string) => ({ maybeSingle: async () => ({ data: state.has(key) ? { value_json: structuredClone(state.get(key)) } : null, error: null }) }),
      like: async (_: string, prefix: string) => ({ data: [...state].filter(([key]) => key.startsWith(prefix.replace("%", ""))).map(([key, value_json]) => ({ key, value_json: structuredClone(value_json) })), error: null }) }),
    upsert: async (row: any) => { state.set(row.key, structuredClone(row.value_json)); return { error: null }; },
  };
} }) }));
jest.mock("../../../storage/procurement.repo", () => ({ upsertProcurement: async (item: any) => {
  const existing = procurements.get(item.externalId);
  if (existing) return { isNew: false, isUpdated: false, procurementId: existing.id, changedFields: {}, versionNumber: 0 };
  const uuid = `00000000-0000-4000-8000-${String(procurements.size).padStart(12, "0")}`;
  procurements.set(item.externalId, { id: uuid, source_url: item.sourceUrl, procedure_number: item.procedureNumber, raw: item.rawJson });
  return { isNew: true, isUpdated: false, procurementId: uuid, changedFields: {}, versionNumber: 1 };
} }));
jest.mock("../../../storage/match-alert.repo", () => ({
  upsertMatch: (...a: any[]) => upsertMatch(...a),
  ensurePendingNewTenderAlert: (...a: any[]) => ensurePendingNewTenderAlert(...a),
}));
jest.mock("../../../storage/collect-run.repo", () => ({ startCollectRun: async () => "run-1", finishCollectRun: async () => undefined }));
jest.mock("../../../enrichers/match.enricher", () => ({ enrichMatch: async (item: any, match: any) => ({ telegramMessage: "msg", procurement: item, radarKey: match.radarKey }) }));
jest.mock("../../../jobs/collect.job", () => ({ deliverQueuedNewTenderAlerts: (...a: any[]) => deliver(...a) }));
jest.mock("../../../agent/telegram.commands", () => ({ getCommandBot: () => bot }));
jest.mock("../../../config/env", () => ({ getConfig: () => ({ TELEGRAM_CHAT_ID: "123", TELEGRAM_ADMIN_CHAT_IDS: "999", ALERT_MAX_PER_CYCLE: 10 }) }));
jest.mock("../../../core/lock", () => ({ withDistributedLock: async (_: string, __: string, fn: () => Promise<any>) => fn() }));
jest.mock("../../../core/logger", () => ({ createModuleLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { runEdomexJob } from "../job";
import { requestEdomexPdfConsent, decideEdomexConsent, runEdomexPdfWatch } from "../consent";

const ISSEMYM_ROWS = (n: number) => Array.from({ length: n }, (_, i) =>
  `<tr><td>LPN/ISSEMYM/${i}/2026^/sites/default/files/a${i}.pdf</td><td>ISSEMYM^Adquisición de papelería</td></tr>`).join("");
let obra = ISSEMYM_ROWS(3);
let pdfBody = "%PDF-1.4 first";

beforeEach(() => {
  state.clear(); procurements.clear(); jest.clearAllMocks();
  obra = ISSEMYM_ROWS(3); pdfBody = "%PDF-1.4 first";
  bot.sendMessage.mockResolvedValue({ message_id: 77 });
  bot.editMessageReplyMarkup.mockResolvedValue({});
  ensurePendingNewTenderAlert.mockResolvedValue({ alertId: "a1", created: true, status: "pending" });
  deliver.mockResolvedValue(0);
  httpGet.mockImplementation(async (url: string) => ({
    data: url.endsWith(".pdf") ? Buffer.from(pdfBody)
      : url.endsWith("obra-publica") ? `<table>${obra}</table>` : `<table>${ISSEMYM_ROWS(3).replace(/ISSEMYM\//g, "ISSEMYM/BS/")}</table>`,
  }));
});

it("primer ciclo: normaliza el archivo histórico sin matches ni alertas", async () => {
  const summary = await runEdomexJob();
  expect(procurements.size).toBe(6);
  expect([...procurements.values()].every((p) => p.raw.historical_baseline === true)).toBe(true);
  expect(upsertMatch).not.toHaveBeenCalled();
  expect(ensurePendingNewTenderAlert).not.toHaveBeenCalled();
  expect(bot.sendMessage).not.toHaveBeenCalled();
  expect(summary?.status).toBe("success");
  expect(state.get("edomex_last_run").pages["convocatorias-obra-publica"].backfilled).toBe(3);
});

it("respeta una línea base previa (PR #63): sólo filas nuevas generan match y una alerta por convocatoria", async () => {
  await runEdomexJob();
  obra += `<tr><td>LPN/ISSEMYM/90/2026, LPN/ISSEMYM/91/2026^/sites/default/files/n.pdf</td><td>ISSEMYM^Medicamentos</td></tr>`;
  const summary = await runEdomexJob();
  expect(summary?.pages["convocatorias-obra-publica"]).toMatchObject({ newRows: 1, created: 2, matches: 2, alertsQueued: 1 });
  expect(ensurePendingNewTenderAlert).toHaveBeenCalledTimes(1);
  expect(deliver).toHaveBeenCalledWith(10);
  expect(bot.sendMessage).not.toHaveBeenCalled(); // la entrega ocurre en la cola común
  // Reaparición del mismo procedimiento en otro PDF: sin alerta nueva.
  obra += `<tr><td>LPN/ISSEMYM/90/2026^/sites/default/files/n2.pdf</td><td>ISSEMYM^Medicamentos</td></tr>`;
  await runEdomexJob();
  expect(ensurePendingNewTenderAlert).toHaveBeenCalledTimes(1);
});

it("watchdog_only / pausa: discover=false no consulta índices", async () => {
  await runEdomexJob({ discover: false });
  expect(httpGet).not.toHaveBeenCalled();
  expect(deliver).not.toHaveBeenCalled();
});

it("consentimiento: una sola pregunta, Sí persistido antes de vigilar, No definitivo", async () => {
  await runEdomexJob();
  obra += `<tr><td>LPN/ISSEMYM/90/2026^/sites/default/files/n.pdf</td><td>ISSEMYM^Medicamentos</td></tr>`;
  await runEdomexJob();
  const id = procurements.get("secogem:LPN/ISSEMYM/90/2026")!.id;
  expect(await requestEdomexPdfConsent(id)).toBe(true);
  expect(await requestEdomexPdfConsent(id)).toBe(false); // nunca reinsiste
  expect(bot.sendMessage.mock.calls[0][1]).toMatch(/¿Vigilar\?[\s\S]*sólo el PDF oficial/);
  await runEdomexPdfWatch();
  expect(httpGet.mock.calls.some(([url]) => url.endsWith(".pdf"))).toBe(false); // sin Sí no se descarga
  expect(await decideEdomexConsent(id, "123", 666, 77, "yes", bot as any)).toBe("No autorizado");
  expect(await decideEdomexConsent(id, "123", 123, 88, "yes", bot as any)).toBe("Solicitud no válida");
  await decideEdomexConsent(id, "123", 123, 77, "yes", bot as any);
  await runEdomexPdfWatch(); // línea base del PDF
  pdfBody = "%PDF-1.4 changed";
  expect((await runEdomexPdfWatch()).changed).toBe(1);
  await decideEdomexConsent(id, "123", 123, 77, "stop", bot as any);
  httpGet.mockClear();
  await runEdomexPdfWatch();
  expect(httpGet).not.toHaveBeenCalled();

  const other = procurements.get("secogem:LPN/ISSEMYM/0/2026")!.id;
  await requestEdomexPdfConsent(other);
  await decideEdomexConsent(other, "123", 123, 77, "no", bot as any);
  expect(await decideEdomexConsent(other, "123", 123, 77, "yes", bot as any)).toBe("Esta solicitud ya fue respondida");
  expect(await requestEdomexPdfConsent(other)).toBe(false);
});
