import type { NormalizedProcurement } from "../procurement";

/**
 * CONTRACT TEST — NormalizedProcurement
 * 
 * Este test garantiza que cualquier cambio en la interfaz central de datos
 * sea detectado inmediatamente. Previene regresiones en coleccionistas,
 * matchers y enviadores de alertas.
 * 
 * REGLA DE ORO:
 * - canonicalHash es OBLIGATORIO (puede ser string o null).
 * - No eliminar campos existentes sin un proceso de migración.
 */

describe("NormalizedProcurement Contract Validation", () => {
  it("debe cumplir con el shape esperado (Campos Críticos)", () => {
    const mockProcurement: NormalizedProcurement = {
      source: "comprasmx",
      externalId: "ID-123",
      expedienteId: "EXP-123",
      licitationNumber: "LIC-123",
      procedureNumber: "PROC-123",
      title: "Título de prueba",
      description: "Descripción",
      canonicalText: "texto normalizado",
      dependencyName: "Dependencia",
      buyingUnit: "UC",
      procedureType: "licitacion_publica",
      status: "activa",
      state: "CDMX",
      municipality: null,
      amount: 1000,
      currency: "MXN",
      publicationDate: "2026-01-01",
      openingDate: null,
      awardDate: null,
      sourceUrl: "https://example.com",
      attachments: [],
      canonicalFingerprint: "fingerprint",
      lightweightFingerprint: null,
      rawJson: {},
      fetchedAt: "2026-01-01T00:00:00.000Z",
      // CAMPO OBLIGATORIO PARA EVITAR REGRESIONES EN TEST FIXTURES
      canonicalHash: null 
    };

    expect(mockProcurement).toHaveProperty("source");
    expect(mockProcurement).toHaveProperty("externalId");
    expect(mockProcurement).toHaveProperty("canonicalHash");
    expect(typeof mockProcurement.canonicalText).toBe("string");
  });

  it("debe permitir valores nulos en campos opcionales según el contrato", () => {
    const minimalProcurement: NormalizedProcurement = {
      source: "manual",
      externalId: "MIN-001",
      expedienteId: null,
      licitationNumber: null,
      procedureNumber: null,
      title: "", // No puede ser null
      description: null,
      canonicalText: "",
      dependencyName: null,
      buyingUnit: null,
      procedureType: "unknown",
      status: "activa", // Debe ser de tipo ProcurementStatus
      state: null,
      municipality: null,
      amount: null,
      currency: null,
      publicationDate: null,
      openingDate: null,
      awardDate: null,
      sourceUrl: "https://manual.url",
      attachments: [],
      canonicalFingerprint: "min-fp",
      lightweightFingerprint: null,
      rawJson: {},
      fetchedAt: new Date().toISOString(),
      canonicalHash: null
    };

    expect(minimalProcurement.amount).toBeNull();
    expect(minimalProcurement.canonicalHash).toBeNull();
  });
});
