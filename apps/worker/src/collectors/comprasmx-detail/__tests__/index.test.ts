import {
  buildAbsoluteDocumentUrl,
  classifyDocumentHint,
  extractFileType,
  isVisibleDocumentLinkCandidate,
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

  it("url con .rar → rar", () => {
    expect(extractFileType("https://example.com/anexos.rar")).toBe("rar");
  });
});

describe("visible document links", () => {
  it("acepta links por texto visible, href, aria-label o title", () => {
    expect(isVisibleDocumentLinkCandidate({ href: "/descarga/1", text: "Anexo técnico" })).toBe(true);
    expect(isVisibleDocumentLinkCandidate({ href: "/files/convocatoria.pdf", text: "Descargar" })).toBe(true);
    expect(isVisibleDocumentLinkCandidate({ href: "/download/1", ariaLabel: "Documento de bases" })).toBe(true);
    expect(isVisibleDocumentLinkCandidate({ href: "/download/2", title: "Acta de junta de aclaraciones" })).toBe(true);
  });

  it("rechaza navegación no documental", () => {
    expect(isVisibleDocumentLinkCandidate({ href: "/perfil", text: "Ver dependencia" })).toBe(false);
  });

  it("convierte links relativos a URL absoluta", () => {
    expect(buildAbsoluteDocumentUrl("/anexos/base.pdf", "https://comprasmx.example/ficha/123")).toBe(
      "https://comprasmx.example/anexos/base.pdf",
    );
  });
});
