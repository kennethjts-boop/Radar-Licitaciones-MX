jest.mock("../../../core/logger", () => ({ createModuleLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { apiRegistroToRawInput } from "../../../collectors/comprasmx/comprasmx.navigator";
import { classifyPriorityProcurement, EDOMEX_FOCUS_KEYS } from "../../../radars/edomex-focus.matcher";
import { formatEdomexTelegramAlert } from "../../edomex/message";
import { compareContract, dofEvidence, gatherEvidence } from "../evidence";
import { W306, capture306, snap } from "./helpers";
import type { NormalizedProcurement, EnrichedAlert } from "../../../types/procurement";

const listing = (extra: Record<string, unknown> = {}) => apiRegistroToRawInput({
  numero_procedimiento: "LA-12-NEF-012NEF001-N-9-2027", nombre_procedimiento: "SERVICIO", siglas: "BIRMEX", uuid_procedimiento: "a".repeat(32), monto: 150_000_000, ...extra,
} as never);

describe("moneda (criterio 4)", () => {
  it("el listado no confirma moneda: queda pendiente (null), nunca se asume pesos", () => {
    expect(listing().currency).toBeNull();
    expect(listing({ descripcion_moneda: "PESO MEXICANO" }).currency).toBe("MXN");
    expect(listing({ nombre_moneda: "USD" }).currency).toBe("USD");
    expect(listing({ monto: null }).currency).toBeNull();
  });

  const proc = (currency: "MXN" | "USD" | null): NormalizedProcurement => ({
    source: "comprasmx", externalId: "x", title: "SERVICIO", description: null, dependencyName: "BIRMEX", buyingUnit: null,
    amount: 150_000_000, currency, rawJson: {}, attachments: [], canonicalText: "", sourceUrl: "https://x.mx", status: "activa",
  } as unknown as NormalizedProcurement);

  it("un monto sin moneda confirmada en pesos no alerta como confirmado: queda «moneda por confirmar»", () => {
    expect(classifyPriorityProcurement(proc(null))).toMatchObject({ key: EDOMEX_FOCUS_KEYS.birmex, amountStatus: "pending" });
    expect(classifyPriorityProcurement(proc(null))?.matchedTerms).toContain("moneda por confirmar");
    expect(classifyPriorityProcurement(proc("USD"))?.amountStatus).toBe("pending");
    expect(classifyPriorityProcurement(proc("MXN"))).toMatchObject({ amountStatus: "confirmed" });
  });

  it("el aviso lo dice con claridad", () => {
    const alert = (currency: "MXN" | null) => ({
      radarKey: EDOMEX_FOCUS_KEYS.birmex, procurement: proc(currency), scoreReasons: [], detectedAt: "2026-11-09T02:48:19.686Z",
    }) as unknown as EnrichedAlert;
    expect(formatEdomexTelegramAlert(alert(null))).toContain("sin moneda confirmada");
    expect(formatEdomexTelegramAlert(alert("MXN"))).toContain("Presupuesto oficial confirmado");
  });

  it("la lectura oficial del portal confirma la moneda (descripcion_moneda)", () => {
    expect(snap(W306, capture306()).currency).toBe("PESO MEXICANO");
  });
});

describe("contraste con otras fuentes", () => {
  const portal = snap(W306, capture306()).contracts[0];
  const open = { ocid: "x", procedureNumber: W306.procedure, title: null, dependency: null, supplier: "OTRO PROVEEDOR SA", awardedAmount: 900_000_000, currency: "MXN", year: 2026, state: null, status: null, sourceUrl: "https://contratacionesabiertas.hacienda.gob.mx/x", retrievedAt: "2026-11-01T00:00:00.000Z" };

  it("si discrepan, identifica la diferencia y aplica el documento oficial más reciente", () => {
    const note = compareContract(portal, open)!;
    expect(note).toContain("monto máx. $1,249,738,324 (Compras MX) vs $900,000,000 (datos abiertos)");
    expect(note).toContain("proveedor OPERADORA DE SERVICIOS MEDICOS ML SA DE CV (Compras MX) vs OTRO PROVEEDOR SA (datos abiertos)");
    expect(note).toContain("Se aplica Compras MX (documento más reciente)");
    expect(compareContract(portal, { ...open, supplier: portal.licitante, awardedAmount: portal.importeMax })).toBeNull();
  });

  it("DOF: solo cita la fuente si menciona el folio; falla silenciosa con tiempo límite", async () => {
    const hit = await dofEvidence(W306, { http: async () => `<a href="nota_detalle.php?codigo=1">${W306.procedure}</a>`, now: () => new Date("2026-11-09T05:00:00Z") });
    expect(hit).toMatchObject({ source: "DOF", note: "1 publicación(es) que mencionan el folio" });
    expect(await dofEvidence(W306, { http: async () => "<html>sin resultados</html>" })).toBeNull();
    expect(await dofEvidence(W306, { http: async () => { throw new Error("timeout"); } })).toBeNull();
  });

  it("reúne evidencia de respaldo con enlace, fecha del documento y fecha de consulta", async () => {
    const evidence = await gatherEvidence(W306, snap(W306, capture306()), { http: async () => "", ocds: async () => [open], now: () => new Date("2026-11-09T05:00:00Z") });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ source: "Datos abiertos (Contrataciones Abiertas)", documentDate: "2026", consultedAt: "2026-11-09T05:00:00.000Z" });
    expect(evidence[0].url).toContain("contratacionesabiertas");
  });
});
