/**
 * Ejecuta el `upsertProcurement` REAL contra un cliente Supabase en memoria:
 * un cambio aislado de fecha o estatus (título, organismo y unidad idénticos)
 * debe guardarse; una relectura idéntica no debe contar como escritura.
 */
import { normalize } from "../../normalizers/procurement.normalizer";
import { upsertProcurement } from "../procurement.repo";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let writes = 0;

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private op: "select" | "insert" | "update" = "select";
  private payload: Row | Row[] | null = null;
  private head = false;
  constructor(private table: string) {}
  select(_cols?: string, opts?: { count?: string; head?: boolean }) { this.head = Boolean(opts?.head); return this; }
  insert(payload: Row | Row[]) { this.op = "insert"; this.payload = payload; return this; }
  update(payload: Row) { this.op = "update"; this.payload = payload; return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  private rows() { return (tables[this.table] ??= []).filter((row) => this.filters.every((f) => f(row))); }
  private run(): { data: unknown; error: null; count?: number } {
    if (this.op === "insert") {
      writes++;
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      (tables[this.table] ??= []).push(...list.map((row) => ({ ...row })));
      return { data: list, error: null };
    }
    if (this.op === "update") {
      const matched = this.rows();
      const changes = this.payload as Row;
      // Sólo cuenta como escritura efectiva si cambia algún valor distinto de last_seen_at.
      const effective = matched.some((row) => Object.entries(changes).some(([k, v]) => k !== "last_seen_at" && row[k] !== v));
      if (effective) writes++;
      matched.forEach((row) => Object.assign(row, changes));
      return { data: matched, error: null };
    }
    const matched = this.rows();
    return { data: this.head ? null : matched, error: null, count: matched.length };
  }
  maybeSingle() { const r = this.run(); return Promise.resolve({ data: (r.data as Row[])[0] ?? null, error: null }); }
  single() { const r = this.run(); return Promise.resolve({ data: (r.data as Row[])[0] ?? null, error: null }); }
  then<T>(resolve: (value: unknown) => T) { return Promise.resolve(this.run()).then(resolve); }
}

jest.mock("../client", () => ({ getSupabaseClient: () => ({ from: (table: string) => new Query(table) }) }));

const listing = (over: Record<string, unknown> = {}) => normalize({
  source: "comprasmx", sourceUrl: "https://comprasmx.buengobierno.gob.mx/x", externalId: "LA-12-NEF-012NEF001-N-3-2027",
  expedienteId: "E-2026-00113902", licitationNumber: "LA-12-NEF-012NEF001-N-3-2027", procedureNumber: "LA-12-NEF-012NEF001-N-3-2027",
  title: "SERVICIO INTEGRADO REGIONAL CADENA DE SUMINISTRO INSUMOS PARA LA SALUD 2027", description: null,
  dependencyName: "BIRMEX", buyingUnit: "012NEF001 - DIRECCIÓN DE ADMINISTRACIÓN Y FINANZAS", procedureType: "LICITACIÓN PÚBLICA",
  status: "VIGENTE", publicationDate: null, openingDate: "2026-11-05T10:00:00", awardDate: null, state: null, municipality: null,
  amount: null, currency: "MXN", attachments: [], rawJson: {}, ...over,
} as never);

describe("upsertProcurement: campos volátiles", () => {
  beforeEach(() => { for (const key of Object.keys(tables)) delete tables[key]; writes = 0; });

  it("guarda un cambio aislado de fecha de apertura aunque título y organismo sean idénticos", async () => {
    const first = await upsertProcurement(listing(), "src-1");
    expect(first.isNew).toBe(true);
    const id = first.procurementId;
    expect(tables.procurements[0].opening_date).toBe("2026-11-05T10:00:00");

    const second = await upsertProcurement(listing({ openingDate: "2026-11-19T10:00:00" }), "src-1");
    expect(second).toMatchObject({ isNew: false, isUpdated: true, procurementId: id });
    expect(second.changedFields.opening_date).toEqual({ prev: "2026-11-05", next: "2026-11-19" });
    expect(String(tables.procurements[0].opening_date).slice(0, 10)).toBe("2026-11-19");
    expect(tables.procurement_versions).toHaveLength(2);
    expect(tables.procurement_versions[1].changed_fields_json).toHaveProperty("opening_date");
  });

  it("guarda un cambio aislado de estatus", async () => {
    await upsertProcurement(listing(), "src-1");
    const result = await upsertProcurement(listing({ status: "CANCELADA" }), "src-1");
    expect(result.isUpdated).toBe(true);
    expect(result.changedFields.status).toMatchObject({ next: "cancelada" });
    expect(tables.procurements[0].status).toBe("cancelada");
  });

  it("una relectura idéntica no es una escritura efectiva y no crea versión", async () => {
    await upsertProcurement(listing({ openingDate: "2026-11-19T10:00:00" }), "src-1");
    const before = writes;
    const again = await upsertProcurement(listing({ openingDate: "2026-11-19T15:30:00" }), "src-1"); // misma fecha, otra hora
    expect(again).toMatchObject({ isNew: false, isUpdated: false });
    expect(writes).toBe(before);
    expect(tables.procurement_versions).toHaveLength(1);
  });

  it("un monto confirmado no se borra cuando el listado no lo trae", async () => {
    await upsertProcurement(listing(), "src-1");
    tables.procurements[0].amount = 5_260_821_391.9;
    const result = await upsertProcurement(listing(), "src-1");
    expect(result.isUpdated).toBe(false);
    expect(tables.procurements[0].amount).toBe(5_260_821_391.9);
  });
});
