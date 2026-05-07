import {
  classifyDocumentHint,
  extractFileType,
} from "../index";

describe("classifyDocumentHint", () => {
  it("filename con 'convocatoria' → convocatoria", () => {
    expect(classifyDocumentHint("convocatoria_bases.pdf", "Bases del procedimiento")).toBe("convocatoria");
  });

  it("title con 'técnico' → anexo_tecnico", () => {
    expect(classifyDocumentHint(null, "Anexo Técnico TDR")).toBe("anexo_tecnico");
  });

  it("title con 'económico' → anexo_economico", () => {
    expect(classifyDocumentHint(null, "Catálogo de conceptos y precios")).toBe("anexo_economico");
  });

  it("filename con 'fallo' → fallo", () => {
    expect(classifyDocumentHint("fallo_adjudicacion.pdf", "Acto del fallo")).toBe("fallo");
  });

  it("texto desconocido → otro", () => {
    expect(classifyDocumentHint(null, "Documento sin clasificar")).toBe("otro");
  });

  it("filename con 'contrato' → contrato", () => {
    expect(classifyDocumentHint("modelo_contrato.docx", "Modelo de contrato")).toBe("contrato");
  });

  it("title con 'legal' → anexo_legal", () => {
    expect(classifyDocumentHint(null, "Requisitos jurídicos")).toBe("anexo_legal");
  });
});

describe("extractFileType", () => {
  it("url con .pdf → pdf", () => {
    expect(extractFileType("https://example.com/doc.pdf")).toBe("pdf");
  });

  it("url con .docx y query string → docx", () => {
    expect(extractFileType("https://example.com/file.docx?v=1")).toBe("docx");
  });

  it("url sin extensión conocida → other", () => {
    expect(extractFileType("https://example.com/descarga")).toBe("other");
  });

  it("url con .xlsx → xlsx", () => {
    expect(extractFileType("https://example.com/catalogo.xlsx")).toBe("xlsx");
  });

  it("url con .zip → zip", () => {
    expect(extractFileType("https://example.com/bases.zip")).toBe("zip");
  });
});
