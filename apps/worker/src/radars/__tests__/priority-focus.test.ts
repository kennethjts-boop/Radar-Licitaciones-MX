import { classifyEdomexProcurement, EDOMEX_FOCUS_KEYS, expectedFocusVersionKey, isPublishedOnOrAfterEdomexCutoff, PRIORITY_RADAR_VERSION_KEY } from "../edomex-focus.matcher";
import { evaluateProcurementAgainstRadar } from "../../matchers/matcher";
import { getRadarByKey } from "../index";
import type { NormalizedProcurement } from "../../types/procurement";

function proc(over: Partial<NormalizedProcurement>): NormalizedProcurement {
  return {
    source: "comprasmx", externalId: "x", title: "Servicio", description: null, dependencyName: null,
    buyingUnit: null, amount: null, procedureNumber: null, licitationNumber: null, rawJson: {}, attachments: [], canonicalText: "", sourceUrl: "https://x.mx/a", status: "activa", publicationDate: null, openingDate: null,
    ...over,
  } as unknown as NormalizedProcurement;
}

describe("focos de prioridad (BIRMEX, DIFEM, JCEM, Salud Edomex)", () => {
  it("BIRMEX: por siglas, razón social y unidad 012NEF001, cualquier giro y monto", () => {
    expect(classifyEdomexProcurement(proc({ dependencyName: "BIRMEX", title: "Servicio de calibración" }))?.key)
      .toBe(EDOMEX_FOCUS_KEYS.birmex);
    expect(classifyEdomexProcurement(proc({ dependencyName: "LABORATORIOS DE BIOLÓGICOS Y REACTIVOS DE MÉXICO, S.A. DE C.V." }))?.key)
      .toBe(EDOMEX_FOCUS_KEYS.birmex);
    expect(classifyEdomexProcurement(proc({ buyingUnit: "012NEF001 - DIRECCIÓN DE ADMINISTRACIÓN Y FINANZAS", amount: 5 }))?.key)
      .toBe(EDOMEX_FOCUS_KEYS.birmex);
    expect(classifyEdomexProcurement(proc({ dependencyName: "IMSS", title: "Compra consolidada de medicamentos" }))).toBeNull();
  });

  it("DIFEM estatal sí; DIF municipal y DIF Nacional no", () => {
    const secogem = (dependencyName: string) => proc({ source: "secogem_edomex", dependencyName });
    expect(classifyEdomexProcurement(secogem("Sistema para el Desarrollo Integral de la Familia del Estado de México (DIFEM)"))?.key)
      .toBe(EDOMEX_FOCUS_KEYS.difem);
    expect(classifyEdomexProcurement(secogem("DIF Municipal de Toluca"))).toBeNull();
    expect(classifyEdomexProcurement(secogem("Sistema Nacional para el Desarrollo Integral de la Familia (SNDIF)"))).toBeNull();
  });

  it("JCEM: toda convocatoria, con o sin monto; destaca > 100 MDP", () => {
    const base = { source: "secogem_edomex", dependencyName: "Junta de Caminos del Estado de México (JCEM)" } as const;
    expect(classifyEdomexProcurement(proc({ ...base, title: "Adquisición de pintura" }))).toMatchObject({
      key: EDOMEX_FOCUS_KEYS.jcem, amountStatus: "pending" });
    const big = classifyEdomexProcurement(proc({ ...base, amount: 150_000_000 }));
    expect(big?.scoreReasons).toContain("amount_above_100m");
    expect(classifyEdomexProcurement(proc({ ...base, amount: 90_000_000 }))?.scoreReasons).toContain("amount_known");
  });

  it("Salud estatal: ISEM y SSEM distinguidos; ISSEMyM, IMSS y Salud federal no", () => {
    const secogem = (dependencyName: string) => proc({ source: "secogem_edomex", dependencyName });
    const isem = classifyEdomexProcurement(secogem("Instituto de Salud del Estado de México (ISEM)"));
    expect(isem).toMatchObject({ key: EDOMEX_FOCUS_KEYS.salud, matchedTerms: ["ISEM"] });
    expect(classifyEdomexProcurement(secogem("Secretaría de Salud del Estado de México"))?.matchedTerms).toEqual(["Secretaría de Salud"]);
    expect(classifyEdomexProcurement(secogem("ISSEMyM"))?.key).toBe(EDOMEX_FOCUS_KEYS.issemym);
    expect(classifyEdomexProcurement(proc({ dependencyName: "SECRETARÍA DE SALUD" }))).toBeNull();
  });

  it("registro, versión y evaluación del radar", () => {
    expect(getRadarByKey(EDOMEX_FOCUS_KEYS.birmex)?.isActive).toBe(true);
    expect(expectedFocusVersionKey(EDOMEX_FOCUS_KEYS.birmex)).toBe(PRIORITY_RADAR_VERSION_KEY);
    expect(expectedFocusVersionKey(EDOMEX_FOCUS_KEYS.issemym)).toBe("edomex_20261025");
    const radar = getRadarByKey(EDOMEX_FOCUS_KEYS.birmex)!;
    const match = evaluateProcurementAgainstRadar(proc({ dependencyName: "BIRMEX", title: "Software" }), radar, true, null);
    expect(match).toMatchObject({ radarKey: EDOMEX_FOCUS_KEYS.birmex, matchLevel: "high" });
    expect(match?.explanation).toContain("BIRMEX");
  });

  it("corte de 30 días propio de los focos de prioridad", () => {
    const d = new Date("2026-10-15T12:00:00Z");
    expect(isPublishedOnOrAfterEdomexCutoff(d, EDOMEX_FOCUS_KEYS.birmex)).toBe(true);
    expect(isPublishedOnOrAfterEdomexCutoff(d, EDOMEX_FOCUS_KEYS.issemym)).toBe(false);
    expect(isPublishedOnOrAfterEdomexCutoff(new Date("2026-10-01T12:00:00Z"), EDOMEX_FOCUS_KEYS.salud)).toBe(false);
  });
});
