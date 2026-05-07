// src/core/__tests__/http-server.test.ts
import { mapEnrichmentToSections } from "../http-server";

describe("mapEnrichmentToSections", () => {
  it("retorna disponible:false para ambos cuando enrichmentData es null", () => {
    const result = mapEnrichmentToSections(null);
    expect(result.techo).toMatchObject({ disponible: false });
    expect(result.antecedentes).toMatchObject({ disponible: false });
    expect((result.techo as { nota: string }).nota).toContain("Enriquecimiento pendiente");
  });

  it("retorna techo disponible:true cuando hay ceiling data", () => {
    const enrichmentData = {
      ceiling: {
        directCeiling: 5000000,
        estimatedMin: null,
        estimatedMax: null,
        average: null,
        confidence: "alta",
        explanation: "Techo localizado directamente.",
        legalWarning: "Info pública.",
      },
    };
    const result = mapEnrichmentToSections(enrichmentData);
    expect(result.techo).toMatchObject({ disponible: true, directCeiling: 5000000, confidence: "alta" });
    expect(result.antecedentes).toMatchObject({ disponible: false });
  });

  it("retorna antecedentes disponible:true cuando hay similar data", () => {
    const enrichmentData = {
      ceiling: null,
      similar: [
        { procedureId: "LP-001", source: "compranet-historico", title: "Contrato A", similarityScore: 0.9, awardedAmount: 1200000, year: 2023 },
        { procedureId: "LP-002", source: "pnt-sipot", title: "Contrato B", similarityScore: 0.7, awardedAmount: 800000, year: 2022 },
      ],
    };
    const result = mapEnrichmentToSections(enrichmentData);
    expect(result.antecedentes).toMatchObject({ disponible: true, totalSimilares: 2 });
    expect((result.antecedentes as { contratos: unknown[] }).contratos).toHaveLength(2);
  });
});
