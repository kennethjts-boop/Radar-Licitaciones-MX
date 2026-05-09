// src/core/__tests__/http-server.test.ts
import { mapEnrichmentToSections } from "../http-server";

describe("mapEnrichmentToSections", () => {
  it("retorna disponible:false para ambos cuando enrichmentData es null", () => {
    const result = mapEnrichmentToSections(null);
    expect(result.techo).toMatchObject({ disponible: false });
    expect(result.antecedentes).toMatchObject({ disponible: false });
    expect(result.documentos).toMatchObject({ disponible: false });
    expect(result.requisitos).toMatchObject({ disponible: false });
    expect(result.fuentes).toMatchObject({ disponible: false });
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

  it("retorna publicaciones DOF dentro de antecedentes cuando existen", () => {
    const enrichmentData = {
      dofPublications: [
        { title: "Convocatoria CAPUFE", dependency: "CAPUFE", publicationDate: "08/05/2026", dofUrl: "https://dof.gob.mx/nota", procedureNumber: null },
      ],
    };
    const result = mapEnrichmentToSections(enrichmentData);
    expect(result.antecedentes).toMatchObject({ disponible: true, totalDofPublicaciones: 1 });
    expect((result.antecedentes as { dof_publicaciones: unknown[] }).dof_publicaciones).toHaveLength(1);
  });

  it("retorna snapshot PNT/SIPOT en fuentes cuando existe", () => {
    const enrichmentData = {
      sipot: {
        total: 1,
        amountMin: 500000,
        amountMax: 750000,
        suppliers: ["Empresa ABC"],
        contracts: [
          { procedureNumber: "LA-001", contractNumber: "C-001", title: "Mantenimiento", dependency: "CAPUFE", supplier: "Empresa ABC", awardedAmount: 750000, year: 2024, sourceUrl: "https://pnt.example" },
        ],
      },
    };
    const result = mapEnrichmentToSections(enrichmentData);
    expect(result.fuentes).toMatchObject({
      disponible: true,
      pnt_sipot: { total: 1, amountMax: 750000 },
    });
  });

  it("retorna documentos y requisitos cuando existen en enrichment data", () => {
    const enrichmentData = {
      documents: [
        { title: "Bases", fileUrl: "https://example.com/bases.pdf", fileType: "pdf", downloadStatus: "ok" },
      ],
      requirements: [
        { category: "tecnico", text: "Presentar anexo técnico", confidence: "alta" },
        { category: "legal", text: "Presentar acta constitutiva", confidence: "alta" },
      ],
    };
    const result = mapEnrichmentToSections(enrichmentData);
    expect(result.documentos).toMatchObject({ disponible: true, total: 1 });
    expect(result.requisitos).toMatchObject({
      disponible: true,
      total: 2,
      por_categoria: { tecnico: 1, economico: 0, legal: 1 },
    });
  });
});
