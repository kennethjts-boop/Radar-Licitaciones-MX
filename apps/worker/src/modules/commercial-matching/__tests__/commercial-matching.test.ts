import { matchCommercialOpportunity } from "..";

function match(title: string, overrides = {}) {
  return matchCommercialOpportunity({
    title,
    description: title,
    buyerName: "Gobierno",
    dependency: "Dependencia publica",
    unit: "Adquisiciones",
    source: "test",
    sourceUrl: "https://example.gob.mx/oportunidad",
    publicationDate: new Date().toISOString(),
    state: null,
    municipality: null,
    fullText: title,
    ...overrides,
  });
}

describe("commercial opportunity matching", () => {
  it("HM HIGHMIL: detecta aceites lubricantes y anticongelantes en Jalisco", () => {
    const result = match(
      "Adquisición de aceites lubricantes y anticongelantes para parque vehicular del Gobierno de Jalisco",
    );

    expect(result.shouldAlert).toBe(true);
    expect(result.matchedProfiles.map((item) => item.profileId)).toContain("hm_highmil_lubricants");
    expect(result.territoryMatched).toBe("Guadalajara / Jalisco");
  });

  it("HM HIGHMIL: detecta grasas y aditivos para maquinaria pesada en Guadalajara", () => {
    const result = match(
      "Suministro de grasas y aditivos para maquinaria pesada en Guadalajara",
    );

    expect(result.shouldAlert).toBe(true);
    expect(result.matchedProfiles[0].profileId).toBe("hm_highmil_lubricants");
  });

  it("HM HIGHMIL: descarta aceite vegetal comestible", () => {
    const result = match(
      "Adquisición de aceite vegetal comestible para comedor institucional en Morelos",
    );

    expect(result.shouldAlert).toBe(false);
    expect(result.discardReason).toBe("negative_keyword");
  });

  it("HM HIGHMIL: descarta aceite de cocina para despensas", () => {
    const result = match("Compra de aceite de cocina para despensas en CDMX");

    expect(result.shouldAlert).toBe(false);
    expect(result.discardReason).toBe("negative_keyword");
  });

  it("PRIMASA y COFORMEX: detecta impresión de formatos y folletos en CDMX", () => {
    const result = match(
      "Servicio de impresión de formatos, folletos y material institucional para dependencia de CDMX",
    );
    const profiles = result.matchedProfiles.map((item) => item.profileId);

    expect(result.shouldAlert).toBe(true);
    expect(profiles).toEqual(expect.arrayContaining(["primasa_printing", "coformex_printing"]));
  });

  it("PRIMASA y COFORMEX: detecta carteles, lonas, trípticos y gafetes", () => {
    const result = match(
      "Impresión de carteles, lonas, trípticos y gafetes para campaña institucional en Ciudad de México",
    );

    expect(result.shouldAlert).toBe(true);
    expect(result.keywordMatches).toEqual(expect.arrayContaining(["carteles", "lonas", "trípticos", "gafetes"]));
  });

  it("PRIMASA y COFORMEX: descarta impresión diagnóstica médica", () => {
    const result = match("Servicio de impresión diagnóstica médica en Toluca");

    expect(result.shouldAlert).toBe(false);
    expect(result.discardReason).toBe("negative_keyword");
  });

  it("UNIFORCE: detecta vigilancia intramuros con guardias en Toluca", () => {
    const result = match(
      "Contratación de servicio de vigilancia intramuros con guardias de seguridad en Toluca",
    );

    expect(result.shouldAlert).toBe(true);
    expect(result.matchedProfiles[0].profileId).toBe("uniforce_security_risk");
  });

  it("UNIFORCE: detecta psicométricas, socioeconómicas y control de confianza", () => {
    const result = match(
      "Servicio de evaluaciones psicométricas, socioeconómicas y control de confianza para personal en Morelos",
    );

    expect(result.shouldAlert).toBe(true);
    expect(result.matchedProfiles[0].profileId).toBe("uniforce_security_risk");
  });

  it("UNIFORCE: detecta guardias armados y desarmados", () => {
    const result = match(
      "Contratación de guardias armados y desarmados para instalaciones públicas en Naucalpan",
    );

    expect(result.shouldAlert).toBe(true);
    expect(result.matchedProfiles[0].profileId).toBe("uniforce_security_risk");
  });

  it("UNIFORCE: descarta seguridad informática y firewall", () => {
    const result = match("Servicio de seguridad informática y firewall para alcaldía CDMX");

    expect(result.shouldAlert).toBe(false);
    expect(result.discardReason).toBe("negative_keyword");
  });

  it("UNIFORCE: descarta antivirus y licencias de ciberseguridad", () => {
    const result = match("Adquisición de antivirus y licencias de ciberseguridad en Jalisco");

    expect(result.shouldAlert).toBe(false);
    expect(result.discardReason).toBe("negative_keyword");
  });

  it("NAG: detecta mantenimiento, remodelación y rehabilitación de oficinas en Morelos", () => {
    const result = match(
      "Servicio de mantenimiento, remodelación y rehabilitación de oficinas públicas en Morelos",
    );

    expect(result.shouldAlert).toBe(true);
    expect(result.matchedProfiles[0].profileId).toBe("grupo_constructor_nag_construction");
  });

  it("NAG: detecta obra civil, pintura e impermeabilización", () => {
    const result = match(
      "Trabajos de obra civil, pintura, impermeabilización y adecuación de espacios en Ecatepec",
    );

    expect(result.shouldAlert).toBe(true);
    expect(result.matchedProfiles[0].profileId).toBe("grupo_constructor_nag_construction");
  });

  it("NAG: descarta mantenimiento de licencias de software", () => {
    const result = match("Mantenimiento de licencias de software en Guadalajara");

    expect(result.shouldAlert).toBe(false);
    expect(result.discardReason).toBe("negative_keyword");
  });

  it("NAG: descarta mantenimiento preventivo a computadoras e impresoras", () => {
    const result = match("Mantenimiento preventivo a computadoras e impresoras en Estado de México");

    expect(result.shouldAlert).toBe(false);
    expect(result.discardReason).toBe("negative_keyword");
  });

  it.each([
    "Morelos",
    "Guadalajara",
    "Jalisco",
    "CDMX",
    "Ciudad de México",
    "Estado de México",
    "Edomex",
    "Toluca",
    "Naucalpan",
    "Ecatepec",
  ])("detecta territorio objetivo: %s", (territory) => {
    const result = match(`Suministro de anticongelantes para parque vehicular en ${territory}`);

    expect(result.shouldAlert).toBe(true);
    expect(result.territoryMatched).not.toBeNull();
  });

  it("marca nacional como posible y baja score si no hay sede clara", () => {
    const result = match(
      "Licitación nacional para suministro de anticongelantes y lubricantes para flotilla institucional",
    );

    expect(result.territoryMatched).toBe("Nacional / posible");
    expect(result.score).toBeLessThan(80);
  });
});
