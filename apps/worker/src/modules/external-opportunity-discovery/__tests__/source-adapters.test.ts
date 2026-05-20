import { isUnwantedTitle, parseHtmlLinks, normalizeRawItem } from "../source-adapters";
import { COMMERCIAL_PROFILES } from "../../commercial-profiles";
import type { RawExternalItem } from "../types";

describe("gob.mx / External OSINT Parser and Source Adapters", () => {
  describe("isUnwantedTitle", () => {
    it("should correctly identify unwanted button/link texts", () => {
      expect(isUnwantedTitle("Continuar leyendo")).toBe(true);
      expect(isUnwantedTitle("Leer más")).toBe(true);
      expect(isUnwantedTitle("Seguir leyendo")).toBe(true);
      expect(isUnwantedTitle("Ver más")).toBe(true);
      expect(isUnwantedTitle("Más información")).toBe(true);
      expect(isUnwantedTitle("continuar leyendo...")).toBe(true);
      expect(isUnwantedTitle("LEER MÁS")).toBe(true);
    });

    it("should accept valid, descriptive titles", () => {
      expect(isUnwantedTitle("Licitación para mantenimiento de oficinas")).toBe(false);
      expect(isUnwantedTitle("Suministro de aceites y lubricantes en Jalisco")).toBe(false);
      expect(isUnwantedTitle("Adquisición de pintura y acabados")).toBe(false);
    });
  });

  describe("parseHtmlLinks", () => {
    const baseUrl = "https://www.morelos.gob.mx";

    it("should extract correct title from card headings if link text is unwanted", () => {
      const html = `
        <div class="dataset-item">
          <h2>Título de Licitación Correcto</h2>
          <a href="/convocatorias/123">Continuar leyendo</a>
        </div>
      `;
      const results = parseHtmlLinks(html, baseUrl, ".gob.mx");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Título de Licitación Correcto");
      expect(results[0].url).toBe("https://www.morelos.gob.mx/convocatorias/123");
    });

    it("should extract correct title from another link in the same container with same href", () => {
      const html = `
        <div class="dataset-item">
          <a href="/convocatorias/123">Licitación de Mantenimiento</a>
          <p>Some snippet text</p>
          <a href="/convocatorias/123">Seguir leyendo</a>
        </div>
      `;
      const results = parseHtmlLinks(html, baseUrl, ".gob.mx");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Licitación de Mantenimiento");
    });

    it("should extract correct title from aria-label attribute of the link", () => {
      const html = `
        <div class="dataset-item">
          <a href="/convocatorias/123" aria-label="Licitación de Obra Pública en Cuernavaca">Continuar leyendo</a>
        </div>
      `;
      const results = parseHtmlLinks(html, baseUrl, ".gob.mx");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Licitación de Obra Pública en Cuernavaca");
    });

    it("should extract correct title from title attribute of the link", () => {
      const html = `
        <div class="dataset-item">
          <a href="/convocatorias/123" title="Mantenimiento correctivo a escuelas de Morelos">Continuar leyendo</a>
        </div>
      `;
      const results = parseHtmlLinks(html, baseUrl, ".gob.mx");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Mantenimiento correctivo a escuelas de Morelos");
    });

    it("should skip item if no descriptive title can be extracted", () => {
      const html = `
        <div class="dataset-item">
          <a href="/convocatorias/123">Continuar leyendo</a>
        </div>
      `;
      const results = parseHtmlLinks(html, baseUrl, ".gob.mx");
      expect(results).toHaveLength(0);
    });
  });

  describe("normalizeRawItem", () => {
    const nagProfile = COMMERCIAL_PROFILES.find(p => p.id === "grupo_constructor_nag_construction")!;

    it("should return null if the raw item title is unwanted", () => {
      const raw: RawExternalItem = {
        sourceId: "test-source",
        sourceName: "gob.mx test",
        sourceType: "official_website",
        sourceUrl: "https://www.morelos.gob.mx/convocatorias/123",
        title: "Continuar leyendo",
        snippet: "Mantenimiento de oficinas gubernamentales en Morelos",
        fetchedAt: new Date().toISOString(),
        publishedAt: null,
        raw: {},
      };

      const result = normalizeRawItem(raw, nagProfile);
      expect(result).toBeNull();
    });

    it("should return normalized lead if the title is valid", () => {
      const raw: RawExternalItem = {
        sourceId: "test-source",
        sourceName: "gob.mx test",
        sourceType: "official_website",
        sourceUrl: "https://www.morelos.gob.mx/convocatorias/123",
        title: "Licitación para Mantenimiento de Edificio",
        snippet: "Mantenimiento de oficinas gubernamentales en Morelos",
        fetchedAt: new Date().toISOString(),
        publishedAt: null,
        raw: {},
      };

      const result = normalizeRawItem(raw, nagProfile);
      expect(result).not.toBeNull();
      expect(result?.title).toBe("Licitación para Mantenimiento de Edificio");
    });
  });
});
