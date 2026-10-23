import { getWatchdogConsent, createWatchdogConsent, updatePendingConsent, approvedWatchdogIds, consentForReply, WatchdogConsent } from "../consent-store";

const mockRows = new Map<string, WatchdogConsent>();
let mockError: { message: string } | null = null;
jest.mock("../../../storage/client", () => ({
  getSupabaseClient: () => ({ from: () => {
    const filters: Array<(key: string, value: WatchdogConsent) => boolean> = [];
    let update: WatchdogConsent | undefined;
    const result = () => {
      if (mockError) return { data: null, error: mockError };
      const rows = [...mockRows].filter(([key, value]) => filters.every((filter) => filter(key, value)));
      if (update) for (const [key] of rows) mockRows.set(key, update);
      return { data: rows.map(([key, value_json]) => ({ key, value_json })), error: null };
    };
    const query: any = {
      select: () => query,
      eq: (field: string, value: unknown) => { filters.push((key, row) => field === "key" ? key === value : String((row as any)[field.split("->>")[1]]) === String(value)); return query; },
      in: (_field: string, values: string[]) => { filters.push((key) => values.includes(key)); return query; },
      like: (_field: string, pattern: string) => { filters.push((key) => key.startsWith(pattern.replace(/%$/, ""))); return query; },
      limit: () => query,
      maybeSingle: async () => { const rows = result(); return { data: rows.data?.[0] ?? null, error: rows.error }; },
      then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
    };
    return {
      select: () => query,
      update: (input: { value_json: WatchdogConsent }) => { update = input.value_json; return query; },
      upsert: async (input: { key: string; value_json: WatchdogConsent }) => {
        if (!mockError && !mockRows.has(input.key)) mockRows.set(input.key, input.value_json);
        return { error: mockError };
      },
    };
  } }),
}));

const pending: WatchdogConsent = { procurementId: "proc-1", label: "N-200", status: "pending", chatId: "123", messageId: 42 };
describe("consentimientos persistidos en system_state", () => {
  beforeEach(() => { mockRows.clear(); mockError = null; });
  it("guarda y vuelve a leer la solicitud sin conceder aprobación", async () => {
    await createWatchdogConsent(pending);
    expect(await getWatchdogConsent("proc-1")).toEqual(pending);
    expect(await approvedWatchdogIds(["proc-1"])).toEqual(new Set());
    expect(await consentForReply("123", 42)).toEqual(pending);
    expect(await consentForReply("999", 42)).toBeNull();
  });
  it("la primera respuesta gana; recrear la solicitud no borra el No", async () => {
    await createWatchdogConsent(pending);
    expect(await updatePendingConsent({ ...pending, status: "declined" })).toBe(true);
    expect(await updatePendingConsent({ ...pending, status: "approved" })).toBe(false);
    await createWatchdogConsent(pending);
    expect((await getWatchdogConsent("proc-1"))?.status).toBe("declined");
    expect(await approvedWatchdogIds(["proc-1"])).toEqual(new Set());
  });
  it("sólo devuelve aprobaciones de las licitaciones consultadas", async () => {
    await createWatchdogConsent({ ...pending, status: "approved" });
    await createWatchdogConsent({ ...pending, procurementId: "proc-2" });
    expect(await approvedWatchdogIds(["proc-1", "proc-2"])).toEqual(new Set(["proc-1"]));
    expect(await approvedWatchdogIds(["proc-2"])).toEqual(new Set());
  });
  it("los errores de lectura y escritura se propagan para impedir activaciones", async () => {
    mockError = { message: "DB offline" };
    await expect(getWatchdogConsent("proc-1")).rejects.toThrow("DB offline");
    await expect(createWatchdogConsent(pending)).rejects.toThrow("DB offline");
    await expect(updatePendingConsent(pending)).rejects.toThrow("DB offline");
    await expect(approvedWatchdogIds(["proc-1"])).rejects.toThrow("DB offline");
  });
});
