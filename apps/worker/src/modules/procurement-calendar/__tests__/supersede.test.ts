let lastRun: Record<string, unknown> | null = null;
jest.mock("../../../storage/client", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "or", "limit"]) chain[m] = () => chain;
      chain.maybeSingle = async () => (table === "system_state"
        ? { data: lastRun ? { value_json: lastRun } : null, error: null }
        : { data: { id: "cf2458a7-d351-4f07-be07-84ac1da0764e" }, error: null });
      return chain;
    },
  }),
}));
jest.mock("../service", () => ({ defaultDeps: {}, isTracking: async () => true }));

import { calendarCoversWatchdogChange, isDateOnlyChange } from "../supersede";
import type { WatchdogChange, WatchdogSnapshotRow } from "../../licitacion-watchdog/types";

const row = (changes: WatchdogChange[]): WatchdogSnapshotRow => ({
  id: "s1", numero_procedimiento: "LA-50-GYR-050GYR035-N-2-2027", snapshot_hash: "h", snapshot_json: {} as never,
  detected_changes: { changes, notification: { kind: "change", status: "pending" } }, created_at: "2026-11-09T04:00:00Z",
});
const apertura: WatchdogChange = {
  kind: "modified", path: "visibleFields.Fecha y hora de presentación y apertura de proposiciones",
  previous: "19/11/2026 10:00", current: "26/11/2026 10:00",
};
const actaJunta: WatchdogChange = {
  kind: "document_added", path: "documents[ACTA DE JUNTA DE ACLARACIONES]", previous: undefined, current: "x",
  document: { name: "ACTA DE JUNTA DE ACLARACIONES.pdf" } as never,
};
const NOW = Date.parse("2026-11-09T04:10:00Z");

describe("deduplicación calendario ↔ watchdog", () => {
  beforeEach(() => { lastRun = { at: "2026-11-09T04:00:00Z", calendar: { tracked: 1 } }; });

  it("un cambio solo de fecha lo cubre el calendario si corrió hace poco", async () => {
    expect(isDateOnlyChange(row([apertura]))).toBe(true);
    expect(await calendarCoversWatchdogChange(row([apertura]), undefined, NOW)).toBe(true);
  });

  it("un documento nuevo de la junta (acta) NO se suprime aunque su nombre diga «junta»", async () => {
    expect(isDateOnlyChange(row([actaJunta]))).toBe(false);
    expect(await calendarCoversWatchdogChange(row([actaJunta]), undefined, NOW)).toBe(false);
  });

  it("si el calendario no ha corrido en 90 min o falló, el watchdog avisa", async () => {
    lastRun = { at: "2026-11-09T02:00:00Z", calendar: { tracked: 1 } };
    expect(await calendarCoversWatchdogChange(row([apertura]), undefined, NOW)).toBe(false);
    lastRun = { at: "2026-11-09T04:00:00Z", calendar: { tracked: 1 }, calendarError: "portal" };
    expect(await calendarCoversWatchdogChange(row([apertura]), undefined, NOW)).toBe(false);
  });
});
