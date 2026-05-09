import { extractRequirements } from "../requirement-extractor";

describe("extractRequirements", () => {
  it("extrae requisito técnico con confianza alta", () => {
    const result = extractRequirements(
      "El licitante deberá presentar anexo técnico con especificaciones técnicas y personal técnico certificado.",
    );
    expect(result.hasRequirements).toBe(true);
    expect(result.counts.tecnico).toBe(1);
    expect(result.requirements[0]).toMatchObject({
      category: "tecnico",
      confidence: "alta",
    });
  });

  it("extrae requisito económico", () => {
    const result = extractRequirements(
      "Se requiere entregar propuesta económica con catálogo de conceptos y precios unitarios firmados.",
    );
    expect(result.counts.economico).toBe(1);
    expect(result.requirements[0].matchedKeywords).toContain("propuesta economica");
  });

  it("extrae requisito legal", () => {
    const result = extractRequirements(
      "El proveedor deberá presentar acta constitutiva, poder notarial y opinión de cumplimiento SAT vigente.",
    );
    expect(result.counts.legal).toBe(1);
    expect(result.requirements[0].confidence).toBe("alta");
  });

  it("ignora menciones sin marcador de requisito", () => {
    const result = extractRequirements(
      "El anexo técnico se menciona como referencia histórica del contrato anterior.",
    );
    expect(result.hasRequirements).toBe(false);
  });

  it("deduplica requisitos repetidos por categoría", () => {
    const text = [
      "El licitante deberá presentar anexo técnico con especificaciones técnicas.",
      "El licitante deberá presentar anexo técnico con especificaciones técnicas.",
    ].join("\n");
    const result = extractRequirements(text);
    expect(result.counts.tecnico).toBe(1);
  });

  it("retorna vacío para texto vacío", () => {
    const result = extractRequirements("");
    expect(result.requirements).toHaveLength(0);
    expect(result.hasRequirements).toBe(false);
  });
});
