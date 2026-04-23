import { chunkText } from "../pdf.util";

// extractTextFromPdf depende del sistema de archivos y pdf-parse — requiere integración.
// chunkText es lógica pura y se puede probar sin mocks.

describe("chunkText", () => {
  it("retorna array vacío para texto vacío", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("retorna texto corto como un solo chunk", () => {
    const text = "Este es un texto corto para prueba.";
    const result = chunkText(text, 800);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  it("divide texto largo en múltiples chunks", () => {
    const longText = Array.from({ length: 200 }, (_, i) =>
      `Párrafo ${i}: Este es un texto de prueba con suficiente contenido para generar múltiples chunks en el sistema de chunking semántico.`
    ).join("\n\n");
    const result = chunkText(longText, 100);
    expect(result.length).toBeGreaterThan(1);
  });

  it("todos los chunks tienen contenido no vacío", () => {
    const text = "Primero.\n\nSegundo.\n\nTercero.\n\nCuarto.\n\nQuinto.";
    const result = chunkText(text, 5, 0);
    expect(result.every((c) => c.trim().length > 0)).toBe(true);
  });

  it("el contenido total de chunks cubre el texto original", () => {
    const text = "palabra uno.\n\npalabra dos.\n\npalabra tres.";
    const result = chunkText(text, 800);
    const allWords = result.join(" ");
    expect(allWords).toContain("uno");
    expect(allWords).toContain("dos");
    expect(allWords).toContain("tres");
  });

  it("maneja texto de solo espacios", () => {
    expect(chunkText("   ")).toEqual([]);
  });
});
