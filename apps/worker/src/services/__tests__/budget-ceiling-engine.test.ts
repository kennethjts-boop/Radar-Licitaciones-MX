import { estimateBudgetCeiling } from "../budget-ceiling-engine";
import type { CeilingInput } from "../budget-ceiling-engine";
import type { SimilarProcedure } from "../procurement-similarity-engine";

function makeSimilar(amount: number): SimilarProcedure {
  return {
    procedureId: "LP-001",
    source: "compranet-historico",
    title: "Mantenimiento vial",
    similarityScore: 0.8,
    reason: "similitud textual 80%",
    awardedAmount: amount,
    supplier: "Empresa SA",
    year: 2023,
    evidenceUrl: null,
  };
}

const baseInput: CeilingInput = {
  directCeilingFound: false,
  directCeilingAmount: null,
  budgetSignals: [],
  similarProcedures: [],
  title: "Mantenimiento vial",
  dependency: "SCT",
};

describe("estimateBudgetCeiling", () => {
  it("nivel 1: retorna directCeiling cuando está disponible", () => {
    const result = estimateBudgetCeiling({
      ...baseInput,
      directCeilingFound: true,
      directCeilingAmount: 2000000,
    });
    expect(result.directCeiling).toBe(2000000);
    expect(result.confidence).toBe("alta");
    expect(result.explanation).toContain("Techo localizado directamente");
  });

  it("nivel 2: calcula min/max/average/median de similares", () => {
    const result = estimateBudgetCeiling({
      ...baseInput,
      similarProcedures: [makeSimilar(1000000), makeSimilar(2000000), makeSimilar(3000000)],
    });
    expect(result.estimatedMin).toBe(1000000);
    expect(result.estimatedMax).toBe(3000000);
    expect(result.average).toBe(2000000);
    expect(result.median).toBe(2000000);
    expect(result.confidence).toBe("media");
  });

  it("nivel 2: confidence baja con 1 similar, alta con 4+", () => {
    const one = estimateBudgetCeiling({ ...baseInput, similarProcedures: [makeSimilar(500000)] });
    expect(one.confidence).toBe("baja");

    const four = estimateBudgetCeiling({
      ...baseInput,
      similarProcedures: [makeSimilar(100000), makeSimilar(200000), makeSimilar(300000), makeSimilar(400000)],
    });
    expect(four.confidence).toBe("alta");
  });

  it("nivel 3: todos null cuando no hay evidencia", () => {
    const result = estimateBudgetCeiling(baseInput);
    expect(result.directCeiling).toBeNull();
    expect(result.estimatedMin).toBeNull();
    expect(result.estimatedMax).toBeNull();
    expect(result.confidence).toBe("baja");
    expect(result.explanation).toContain("Sin evidencia");
  });

  it("legalWarning siempre presente", () => {
    const result = estimateBudgetCeiling(baseInput);
    expect(result.legalWarning).toContain("información pública");
  });

  it("ignora similares con awardedAmount null o 0", () => {
    const result = estimateBudgetCeiling({
      ...baseInput,
      similarProcedures: [
        makeSimilar(0),
        { ...makeSimilar(0), awardedAmount: null },
      ],
    });
    expect(result.estimatedMin).toBeNull();
    expect(result.confidence).toBe("baja");
  });
});
