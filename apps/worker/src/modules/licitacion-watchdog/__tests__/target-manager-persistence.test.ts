import {
  activateWatchdogTarget,
  deactivateWatchdogTarget,
  getAllTargets,
  listPersistentTargets,
} from "../target-manager";

const mockState = {
  procurements: [{
    id: "8e4f5883-9876-41ac-9dad-d659bacfab2b",
    external_id: "LA-09-J0U-009J0U001-N-68-2026",
    procedure_number: "LA-09-J0U-009J0U001-N-68-2026",
    licitation_number: "LA-09-J0U-009J0U001-N-68-2026",
    title: "CAPUFE N-68",
    dependency_name: "CAPUFE",
    source_url: "https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/1daccbec8b4b4c4aba85c8793886a1bf/procedimiento",
  }],
  targets: [] as Array<Record<string, unknown>>,
  snapshots: [{ id: "historic-snapshot", numero: "LA-09-J0U-009J0U001-N-68-2026" }],
};

class SelectQuery {
  private filters: Array<[string, unknown]> = [];
  private orValue: string | null = null;

  constructor(private table: "procurements" | "watchdog_targets") {}
  eq(field: string, value: unknown) { this.filters.push([field, value]); return this; }
  or(value: string) { this.orValue = value; return this; }
  limit() { return this; }
  order() { return Promise.resolve({ data: this.rows(), error: null }); }
  maybeSingle() { return Promise.resolve({ data: this.rows()[0] ?? null, error: null }); }

  private rows(): Array<Record<string, unknown>> {
    let rows = this.table === "procurements" ? mockState.procurements : mockState.targets;
    rows = rows.filter((row) => this.filters.every(([field, value]) => row[field] === value));
    if (this.orValue && this.table === "procurements") {
      const searched = this.orValue.split(",")[0].split(".eq.")[1];
      rows = mockState.procurements.filter((row) =>
        [row.external_id, row.procedure_number, row.licitation_number].includes(searched));
    }
    return rows;
  }
}

jest.mock("../../../storage/client", () => ({
  getSupabaseClient: () => ({
    from: (table: "procurements" | "watchdog_targets") => ({
      select: () => new SelectQuery(table),
      upsert: (input: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            const existing = mockState.targets.find((row) => row.procurement_id === input.procurement_id);
            const row = existing ?? {
              id: `target-${mockState.targets.length + 1}`,
              created_at: "2026-08-13T00:00:00Z",
              last_checked_at: null,
              last_snapshot_id: "historic-snapshot",
              metadata: {},
            };
            Object.assign(row, input);
            if (!existing) mockState.targets.push(row);
            return { data: row, error: null };
          },
        }),
      }),
      update: (input: Record<string, unknown>) => ({
        eq: async (field: string, value: unknown) => {
          const row = mockState.targets.find((candidate) => candidate[field] === value);
          if (row) Object.assign(row, input);
          return { error: null };
        },
      }),
    }),
  }),
}));

describe("watchdog targets persistentes", () => {
  beforeEach(() => {
    mockState.targets.length = 0;
  });

  it("activar dos veces es idempotente y crea un solo target", async () => {
    const first = await activateWatchdogTarget(mockState.procurements[0].id, "CAPUFE · N-68");
    const second = await activateWatchdogTarget(mockState.procurements[0].id, "CAPUFE · N-68");
    expect(first.id).toBe(second.id);
    expect(mockState.targets).toHaveLength(1);
    expect(second.active).toBe(true);
  });

  it("desactivar conserva snapshots e historial y reactivar reutiliza el target", async () => {
    const target = await activateWatchdogTarget(mockState.procurements[0].id, "CAPUFE · N-68");
    const historyBefore = structuredClone(mockState.snapshots);
    expect(await deactivateWatchdogTarget(target.id)).toBe(true);
    expect((await listPersistentTargets(true))!).toHaveLength(0);
    expect(mockState.snapshots).toEqual(historyBefore);

    const reactivated = await activateWatchdogTarget(mockState.procurements[0].id, "CAPUFE · N-68");
    expect(reactivated.id).toBe(target.id);
    expect(reactivated.deactivatedAt).toBeNull();
    expect(mockState.snapshots).toEqual(historyBefore);
  });

  it("el scheduler obtiene únicamente targets activos y N-68 conserva su referencia histórica", async () => {
    const active = await activateWatchdogTarget(mockState.procurements[0].id, "CAPUFE · N-68");
    mockState.targets.push({
      ...mockState.targets[0],
      id: "target-inactive",
      procurement_id: "other-procurement",
      procedure_number: "OTHER-N-1",
      active: false,
      last_snapshot_id: "other-history",
    });
    const scheduled = await getAllTargets();
    expect(scheduled.map((item) => item.numero)).toEqual([active.numero]);
    expect(mockState.targets[0].last_snapshot_id).toBe("historic-snapshot");
  });
});
