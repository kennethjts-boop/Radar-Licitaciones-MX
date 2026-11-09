import {
  classifyEdomexProcurement, EDOMEX_FOCUS_KEYS, expectedFocusVersionKey, isPublishedOnOrAfterEdomexCutoff,
  meetsPriorityThreshold, priorityMinAmount, PRIORITY_RADAR_VERSION_KEY,
} from "../edomex-focus.matcher";
import { evaluateProcurementAgainstRadar } from "../../matchers/matcher";
import { getRadarByKey } from "../index";
import type { NormalizedProcurement } from "../../types/procurement";

function proc(over: Partial<NormalizedProcurement>): NormalizedProcurement {
  return {
    source: "comprasmx", externalId: "x", title: "Servicio", description: null, dependencyName: null,
    buyingUnit: null, amount: null, procedureNumber: null, licitationNumber: null, rawJson: {}, attachments: [],
    canonicalText: "", sourceUrl: "https://x.mx/a", status: "activa", publicationDate: null, openingDate: null,
    // Con monto, la moneda confirmada en pesos es parte del dato (el listado no la trae: se contrasta con el portal).
    currency: over.amount != null ? "MXN" : null,
    ...over,
  } as unknown as NormalizedProcurement;
}
const secogem = (dependencyName: string, over: Partial<NormalizedProcurement> = {}) =>
  proc({ source: "secogem_edomex", dependencyName, ...over });

describe("focos de prioridad con umbral de presupuesto oficial", () => {
  afterEach(() => {
    delete process.env.BIRMEX_MIN_AMOUNT_MXN;
    delete process.env.JCEM_MIN_AMOUNT_MXN;
  });

  it("caso 1: monto inferior al umbral no califica como oportunidad prioritaria", () => {
    const d = classifyEdomexProcurement(proc({ dependencyName: "BIRMEX", title: "Servicio de calibración", amount: 99_999_999.99 }));
    expect(d).toBeNull();
    expect(meetsPriorityThreshold(EDOMEX_FOCUS_KEYS.birmex, 99_999_999.99)).toBe(false);
    // ISEM de $50 MDP: no es foco de prioridad; sólo aplican las reglas anteriores (alto monto >= 20 MDP).
    expect(classifyEdomexProcurement(secogem("Instituto de Salud del Estado de México (ISEM)", { amount: 50_000_000, title: "Suministro de medicamentos" }))?.key)
      .toBe(EDOMEX_FOCUS_KEYS.oportunidades);
  });

  it("caso 2: exactamente $100 millones sí califica (confirmado)", () => {
    const d = classifyEdomexProcurement(proc({ dependencyName: "BIRMEX", amount: 100_000_000 }));
    expect(d).toMatchObject({ key: EDOMEX_FOCUS_KEYS.birmex, amountStatus: "confirmed" });
    expect(d?.scoreReasons).toContain("amount_meets_threshold");
    expect(meetsPriorityThreshold(EDOMEX_FOCUS_KEYS.birmex, 100_000_000)).toBe(true);
  });

  it("monto sin moneda confirmada: queda «monto por verificar» hasta contrastarlo con el documento oficial", () => {
    const pending = classifyEdomexProcurement(proc({ dependencyName: "BIRMEX", amount: 150_000_000, currency: null }));
    expect(pending).toMatchObject({ key: EDOMEX_FOCUS_KEYS.birmex, amountStatus: "pending" });
    expect(pending?.scoreReasons).toContain("currency_pending");
  });

  it("caso 3: compra consolidada sin monto publicado queda como monto por verificar", () => {
    const d = classifyEdomexProcurement(proc({
      dependencyName: "BIRMEX", buyingUnit: "012NEF001 - DIRECCIÓN DE ADMINISTRACIÓN Y FINANZAS",
      title: "ADQUISICIÓN CONSOLIDADA DE MEDICAMENTOS GENÉRICOS, ONCOLÓGICOS Y ANTIINFECCIOSOS",
    }));
    expect(d).toMatchObject({ key: EDOMEX_FOCUS_KEYS.birmex, amountStatus: "pending" });
    expect(d?.matchedTerms).toContain("monto por verificar");
    expect(d?.scoreReasons).toContain("amount_to_verify");
    const radar = getRadarByKey(EDOMEX_FOCUS_KEYS.birmex)!;
    expect(evaluateProcurementAgainstRadar(proc({ dependencyName: "BIRMEX", title: "Compra consolidada de vacunas" }), radar, true, null))
      .toMatchObject({ matchLevel: "medium" });
  });

  it("sin monto ni señales de gran alcance no se guarda como oportunidad prioritaria", () => {
    expect(classifyEdomexProcurement(proc({ dependencyName: "BIRMEX", title: "Servicio de fumigación y control de fauna" }))).toBeNull();
  });

  it("contrato multianual y alcance estatal/nacional también quedan por verificar", () => {
    expect(classifyEdomexProcurement(secogem("Junta de Caminos del Estado de México (JCEM)", { title: "Contrato multianual de conservación" }))
      ?.amountStatus).toBe("pending");
    expect(classifyEdomexProcurement(secogem("Sistema para el Desarrollo Integral de la Familia del Estado de México (DIFEM)",
      { title: "Servicio integral de alcance estatal" }))?.amountStatus).toBe("pending");
  });

  it("convocatoria agrupada no hereda el presupuesto conjunto", () => {
    const d = classifyEdomexProcurement(secogem("Instituto de Salud del Estado de México (ISEM)", {
      amount: 500_000_000, title: "Servicio de laboratorio", rawJson: { monto_estado: "convocatoria_agrupada" },
    }));
    expect(d?.key).not.toBe(EDOMEX_FOCUS_KEYS.salud);
  });

  it("umbral configurable por radar con valor inicial de $100 MDP", () => {
    expect(priorityMinAmount(EDOMEX_FOCUS_KEYS.jcem)).toBe(100_000_000);
    process.env.JCEM_MIN_AMOUNT_MXN = "150000000";
    expect(priorityMinAmount(EDOMEX_FOCUS_KEYS.jcem)).toBe(150_000_000);
    expect(priorityMinAmount(EDOMEX_FOCUS_KEYS.birmex)).toBe(100_000_000);
    expect(priorityMinAmount(EDOMEX_FOCUS_KEYS.issemym)).toBeNull();
    expect(meetsPriorityThreshold(EDOMEX_FOCUS_KEYS.issemym, null)).toBe(true);
  });

  it("DIFEM estatal sí; DIF municipal y DIF Nacional no", () => {
    const big = { amount: 120_000_000 };
    expect(classifyEdomexProcurement(secogem("Sistema para el Desarrollo Integral de la Familia del Estado de México (DIFEM)", big))?.key)
      .toBe(EDOMEX_FOCUS_KEYS.difem);
    expect(classifyEdomexProcurement(secogem("DIF Municipal de Toluca", big))).toBeNull();
    expect(classifyEdomexProcurement(secogem("Sistema Nacional para el Desarrollo Integral de la Familia (SNDIF)", big))).toBeNull();
  });

  it("Salud estatal: ISEM y SSEM distinguidos; ISSEMyM conserva su foco; salud federal no", () => {
    const big = { amount: 250_000_000 };
    expect(classifyEdomexProcurement(secogem("Instituto de Salud del Estado de México (ISEM)", big)))
      .toMatchObject({ key: EDOMEX_FOCUS_KEYS.salud, matchedTerms: ["ISEM"] });
    expect(classifyEdomexProcurement(secogem("Secretaría de Salud del Estado de México", big))?.matchedTerms).toEqual(["Secretaría de Salud"]);
    expect(classifyEdomexProcurement(secogem("ISSEMyM", big))?.key).toBe(EDOMEX_FOCUS_KEYS.issemym);
    expect(classifyEdomexProcurement(proc({ dependencyName: "SECRETARÍA DE SALUD", ...big }))).toBeNull();
  });

  it("registro, versión y corte de 30 días", () => {
    expect(getRadarByKey(EDOMEX_FOCUS_KEYS.birmex)?.isActive).toBe(true);
    expect(expectedFocusVersionKey(EDOMEX_FOCUS_KEYS.birmex)).toBe(PRIORITY_RADAR_VERSION_KEY);
    expect(expectedFocusVersionKey(EDOMEX_FOCUS_KEYS.issemym)).toBe("edomex_20261025");
    const d = new Date("2026-10-15T12:00:00Z");
    expect(isPublishedOnOrAfterEdomexCutoff(d, EDOMEX_FOCUS_KEYS.birmex)).toBe(true);
    expect(isPublishedOnOrAfterEdomexCutoff(d, EDOMEX_FOCUS_KEYS.issemym)).toBe(false);
  });
});
