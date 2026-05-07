import { findSimilarProcurements } from "../procurement-similarity-engine";
import type { SimilarityInput } from "../procurement-similarity-engine";
import type { HistoricoContract } from "../../collectors/compranet-historico/index";

function makeHistorico(overrides: Partial<HistoricoContract> = {}): HistoricoContract {
  return {
    procedureNumber: "LPN-001",
    title: "Mantenimiento vial carreteras Morelos",
    dependency: "SCT",
    supplier: "Constructora ABC",
    awardedAmount: 1500000,
    currency: "MXN",
    year: 2023,
    state: "Morelos",
    contractType: "LP",
    sourceUrl: "https://example.com",
    retrievedAt: "2026-05-07T00:00:00Z",
    ...overrides,
  };
}

const baseInput: SimilarityInput = {
  title: "Mantenimiento de carreteras en Morelos",
  dependency: "SCT",
  state: "Morelos",
  contractType: "LP",
  keywords: ["mantenimiento", "carreteras"],
  scope: "MORELOS_ONLY",
  historico: [],
  sipot: [],
  ocds: [],
};

describe("findSimilarProcurements", () => {
  it("retorna contrato similar cuando Jaccard >= 0.15", async () => {
    const result = await findSimilarProcurements({
      ...baseInput,
      historico: [makeHistorico()],
    });
    expect(result.similarProcedures).toHaveLength(1);
    expect(result.similarProcedures[0].similarityScore).toBeGreaterThanOrEqual(0.15);
    expect(result.similarProcedures[0].source).toBe("compranet-historico");
  });

  it("excluye contrato con similarityScore < 0.15", async () => {
    const result = await findSimilarProcurements({
      ...baseInput,
      historico: [makeHistorico({ title: "Adquisición equipos cómputo Chihuahua" })],
    });
    expect(result.similarProcedures).toHaveLength(0);
  });

  it("aplica bonus de dependencia (+0.1) — score mayor cuando coincide", async () => {
    const withMatch = await findSimilarProcurements({
      ...baseInput,
      historico: [makeHistorico({ dependency: "SCT" })],
    });
    const withoutMatch = await findSimilarProcurements({
      ...baseInput,
      historico: [makeHistorico({ dependency: "IMSS" })],
    });
    const scoreWith = withMatch.similarProcedures[0]?.similarityScore ?? 0;
    const scoreWithout = withoutMatch.similarProcedures[0]?.similarityScore ?? 0;
    expect(scoreWith).toBeGreaterThan(scoreWithout);
  });

  it("retorna máximo 10 resultados", async () => {
    const manyContracts = Array.from({ length: 15 }, (_, i) =>
      makeHistorico({ procedureNumber: `LPN-${i}` }),
    );
    const result = await findSimilarProcurements({ ...baseInput, historico: manyContracts });
    expect(result.similarProcedures.length).toBeLessThanOrEqual(10);
  });

  it("retorna vacío cuando no hay contratos en ninguna fuente", async () => {
    const result = await findSimilarProcurements(baseInput);
    expect(result.similarProcedures).toHaveLength(0);
    expect(result.totalFound).toBe(0);
  });

  it("ordena por similarityScore descendente", async () => {
    const result = await findSimilarProcurements({
      ...baseInput,
      historico: [
        makeHistorico({ title: "Mantenimiento vial carreteras Morelos 2023", dependency: "SCT" }),
        makeHistorico({ title: "Obra de infraestructura municipal diferente", dependency: "IMSS" }),
      ],
    });
    if (result.similarProcedures.length >= 2) {
      expect(result.similarProcedures[0].similarityScore).toBeGreaterThanOrEqual(
        result.similarProcedures[1].similarityScore,
      );
    }
  });
});
