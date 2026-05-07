import { filterProcurementScope } from "../procurement-scope-filter";

describe("filterProcurementScope", () => {
  // 1. Morelos en state → MORELOS_ONLY, allowed
  it("state=Morelos → MORELOS_ONLY, allowed", () => {
    const result = filterProcurementScope({ state: "Morelos", status: "vigente" });
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("MORELOS_ONLY");
    expect(result.is_morelos_related).toBe(true);
  });

  // 2. Cuernavaca en municipality → MORELOS_ONLY, allowed
  it("municipality=Cuernavaca → MORELOS_ONLY, allowed", () => {
    const result = filterProcurementScope({
      municipality: "Cuernavaca",
      state: "Morelos",
      status: "activa",
    });
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("MORELOS_ONLY");
    expect(result.is_morelos_related).toBe(true);
  });

  // 3. CAPUFE + desierta → NATIONAL_CAPUFE_DESIERTA, allowed
  it("CAPUFE + desierta → NATIONAL_CAPUFE_DESIERTA, allowed", () => {
    const result = filterProcurementScope({
      dependency: "CAPUFE — Caminos y Puentes Federales",
      status: "desierta",
      state: "Ciudad de México",
    });
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("NATIONAL_CAPUFE_DESIERTA");
    expect(result.is_capufe).toBe(true);
    expect(result.is_desierta).toBe(true);
  });

  // 4. CAPUFE sin desierta, fuera de Morelos → REJECTED
  it("CAPUFE activo fuera de Morelos → REJECTED", () => {
    const result = filterProcurementScope({
      dependency: "CAPUFE",
      status: "publicada",
      state: "Jalisco",
    });
    expect(result.allowed).toBe(false);
    expect(result.scope).toBe("REJECTED_OUT_OF_SCOPE");
  });

  // 5. Desierta sin CAPUFE, fuera de Morelos → REJECTED
  it("desierta sin CAPUFE fuera de Morelos → REJECTED", () => {
    const result = filterProcurementScope({
      dependency: "IMSS",
      status: "declarada desierta",
      state: "Jalisco",
    });
    expect(result.allowed).toBe(false);
    expect(result.scope).toBe("REJECTED_OUT_OF_SCOPE");
    expect(result.is_desierta).toBe(true);
    expect(result.is_capufe).toBe(false);
  });

  // 6. Licitación CDMX normal → REJECTED
  it("licitación normal en CDMX → REJECTED", () => {
    const result = filterProcurementScope({
      dependency: "Secretaría de Salud",
      status: "publicada",
      state: "Ciudad de México",
      municipality: "Coyoacán",
    });
    expect(result.allowed).toBe(false);
    expect(result.scope).toBe("REJECTED_OUT_OF_SCOPE");
  });

  // 7. CAPUFE Morelos activa → MORELOS_ONLY (Morelos gana, no es desierta)
  it("CAPUFE activo en Morelos → MORELOS_ONLY (Morelos gana)", () => {
    const result = filterProcurementScope({
      dependency: "CAPUFE",
      status: "activa",
      state: "Morelos",
    });
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("MORELOS_ONLY");
    expect(result.is_capufe).toBe(true);
    expect(result.is_desierta).toBe(false);
    expect(result.is_morelos_related).toBe(true);
  });

  // 8. Desierta Morelos no CAPUFE → MORELOS_ONLY
  it("desierta en Morelos, no CAPUFE → MORELOS_ONLY", () => {
    const result = filterProcurementScope({
      dependency: "Hospital General de Cuernavaca",
      status: "desierta",
      state: "Morelos",
    });
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("MORELOS_ONLY");
    expect(result.is_desierta).toBe(true);
    expect(result.is_capufe).toBe(false);
  });

  // 9. CAPUFE + desierta + Morelos → NATIONAL_CAPUFE_DESIERTA (CAPUFE+desierta gana)
  it("CAPUFE + desierta + Morelos → NATIONAL_CAPUFE_DESIERTA gana sobre Morelos", () => {
    const result = filterProcurementScope({
      dependency: "CAPUFE",
      status: "procedimiento desierto",
      state: "Morelos",
    });
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("NATIONAL_CAPUFE_DESIERTA");
    expect(result.is_capufe).toBe(true);
    expect(result.is_desierta).toBe(true);
    expect(result.is_morelos_related).toBe(true);
  });

  // 10. Sin datos → REJECTED
  it("sin datos → REJECTED", () => {
    const result = filterProcurementScope({});
    expect(result.allowed).toBe(false);
    expect(result.scope).toBe("REJECTED_OUT_OF_SCOPE");
    expect(result.is_capufe).toBe(false);
    expect(result.is_desierta).toBe(false);
    expect(result.is_morelos_related).toBe(false);
  });

  // Extra: detección por canonical_text (Morelos en texto libre)
  it("canonical_text con 'cuernavaca' → MORELOS_ONLY", () => {
    const result = filterProcurementScope({
      canonical_text: "Obra en municipio de Cuernavaca, Morelos. Mantenimiento vial.",
      status: "activa",
    });
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("MORELOS_ONLY");
  });

  // Extra: accentos normalizados (tlaltizapán con tilde)
  it("municipality con acento 'Tlaltizapán' → reconocido como Morelos", () => {
    const result = filterProcurementScope({
      municipality: "Tlaltizapán",
      status: "vigente",
    });
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("MORELOS_ONLY");
  });
});
