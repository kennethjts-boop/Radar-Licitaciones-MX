import { extractOfficialBudget } from "../official-budget-extractor";

describe("extractOfficialBudget", () => {
  it("toma el presupuesto máximo del procedimiento y devuelve la página", () => {
    const pages = [
      "BASES DE LICITACIÓN\nObjeto: adquisición consolidada de medicamentos.",
      "Para la presente contratación se cuenta con un presupuesto máximo autorizado de $245,300,000.50 (doscientos cuarenta y cinco millones) IVA incluido.",
    ];
    const found = extractOfficialBudget(pages);
    expect(found).toMatchObject({ amount: 245_300_000.5, page: 2 });
    expect(found?.excerpt).toContain("presupuesto máximo autorizado");
  });

  it("acepta techo presupuestal en millones", () => {
    expect(extractOfficialBudget(["El techo presupuestal asciende a 120 millones de pesos."])).toMatchObject({ amount: 120_000_000, page: 1 });
  });

  it("descarta capital contable, costo de bases, garantías, experiencia y presupuesto general", () => {
    const pages = [
      "El licitante deberá acreditar capital contable mínimo de $150,000,000.00.",
      "El costo de las bases es de $5,000.00 y la garantía de cumplimiento será del 10% del monto máximo $30,000,000.00.",
      "Experiencia: contratos similares por un monto de $400,000,000.00.",
      "El presupuesto general del programa para el ejercicio es de $900,000,000.00.",
    ];
    expect(extractOfficialBudget(pages)).toBeNull();
  });

  it("sin cifra rotulada no confirma nada", () => {
    expect(extractOfficialBudget(["Entrega en 30 días. Importe de la propuesta: lo ofertado."])).toBeNull();
    expect(extractOfficialBudget([])).toBeNull();
  });
});
