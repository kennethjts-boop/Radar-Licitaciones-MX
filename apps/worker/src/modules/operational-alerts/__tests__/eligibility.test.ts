import {
  evaluateNewTenderPublication,
  OPERATIONAL_PUBLICATION_CUTOFF,
} from "../eligibility";

describe("corte operativo de nuevas licitaciones", () => {
  it("rechaza 12/08/2026 23:59 CDMX", () => {
    expect(evaluateNewTenderPublication("12/08/2026 23:59").eligible).toBe(false);
  });

  it("acepta exactamente 13/08/2026 00:00 CDMX", () => {
    const result = evaluateNewTenderPublication("13/08/2026 00:00");
    expect(result.eligible).toBe(true);
    expect(result.publishedAt?.toISOString()).toBe("2026-08-13T06:00:00.000Z");
    expect(OPERATIONAL_PUBLICATION_CUTOFF.toISOString()).toBe("2026-08-13T06:00:00.000Z");
  });

  it("acepta una publicación durante el 13/08", () => {
    expect(evaluateNewTenderPublication("13/08/2026 14:30").eligible).toBe(true);
  });

  it("rechaza una antigua aunque haya sido descubierta hoy", () => {
    expect(evaluateNewTenderPublication("2026-08-12")).toMatchObject({
      eligible: false,
      reason: "published_before_cutoff",
    });
  });

  it("rechaza una antigua modificada hoy como alerta nueva", () => {
    const modifiedToday = "2026-08-13T18:00:00-06:00";
    expect(modifiedToday).toContain("2026-08-13");
    expect(evaluateNewTenderPublication("2026-08-01").eligible).toBe(false);
  });

  it("rechaza fecha oficial ausente o inválida", () => {
    expect(evaluateNewTenderPublication(null)).toMatchObject({
      eligible: false,
      reason: "publication_date_unverifiable",
    });
    expect(evaluateNewTenderPublication("no verificable").eligible).toBe(false);
  });
});
