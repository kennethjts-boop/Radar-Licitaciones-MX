import { classifyDocument } from "../document-classifier";

describe("classifyDocument", () => {
  it("detecta convocatoria", () => {
    const r = classifyDocument({ text: "CONVOCATORIA a licitación pública nacional número LPN-001" });
    expect(r.documentType).toBe("convocatoria");
    expect(r.confidence).not.toBe("baja");
  });

  it("detecta bases", () => {
    const r = classifyDocument({ text: "BASES DE LICITACIÓN para contratación de servicios de mantenimiento" });
    expect(r.documentType).toBe("bases");
  });

  it("detecta anexo técnico", () => {
    const r = classifyDocument({ text: "ANEXO TÉCNICO — Especificaciones del servicio a contratar" });
    expect(r.documentType).toBe("anexo_tecnico");
  });

  it("detecta anexo económico", () => {
    const r = classifyDocument({ text: "ANEXO ECONÓMICO precios unitarios de los trabajos" });
    expect(r.documentType).toBe("anexo_economico");
  });

  it("detecta contrato", () => {
    const r = classifyDocument({ text: "CONTRATO DE PRESTACIÓN DE SERVICIOS que celebran..." });
    expect(r.documentType).toBe("contrato");
  });

  it("detecta acta de apertura", () => {
    const r = classifyDocument({ text: "ACTA DE APERTURA de proposiciones técnicas y económicas" });
    expect(r.documentType).toBe("acta_apertura");
  });

  it("detecta fallo", () => {
    const r = classifyDocument({ text: "FALLO DE ADJUDICACIÓN de la licitación pública LPN-001" });
    expect(r.documentType).toBe("fallo");
  });

  it("detecta catálogo de conceptos", () => {
    const r = classifyDocument({ text: "CATÁLOGO DE CONCEPTOS presupuesto de obra mantenimiento" });
    expect(r.documentType).toBe("catalogo_conceptos");
  });

  it("detecta propuesta técnica", () => {
    const r = classifyDocument({ text: "PROPUESTA TÉCNICA presentada para la licitación" });
    expect(r.documentType).toBe("propuesta_tecnica");
  });

  it("detecta propuesta económica", () => {
    const r = classifyDocument({ text: "PROPUESTA ECONÓMICA precio total ofertado $1,200,000.00" });
    expect(r.documentType).toBe("propuesta_economica");
  });

  it("detecta junta de aclaraciones", () => {
    const r = classifyDocument({ text: "JUNTA DE ACLARACIONES número 1 — preguntas y respuestas del proceso" });
    expect(r.documentType).toBe("junta_aclaraciones");
  });

  it("detecta invitación", () => {
    const r = classifyDocument({ text: "CARTA DE INVITACIÓN a participar en el proceso de adjudicación" });
    expect(r.documentType).toBe("invitacion");
  });

  it("detecta dictamen", () => {
    const r = classifyDocument({ text: "DICTAMEN DE EVALUACIÓN TÉCNICA de las propuestas recibidas" });
    expect(r.documentType).toBe("dictamen");
  });

  it("devuelve otro cuando no coincide nada", () => {
    const r = classifyDocument({ text: "Lorem ipsum sin palabras clave especiales" });
    expect(r.documentType).toBe("otro");
    expect(r.confidence).toBe("baja");
  });

  it("alta confianza cuando texto tiene múltiples keywords del mismo tipo", () => {
    const r = classifyDocument({ text: "FALLO DE ADJUDICACIÓN resultado de la licitacion empresa adjudicada beneficiaria" });
    expect(r.documentType).toBe("fallo");
    expect(r.confidence).toBe("alta");
  });

  it("documentHint coincidente sube confianza a alta", () => {
    const r = classifyDocument({ text: "contrato de servicios", documentHint: "contrato" });
    expect(r.documentType).toBe("contrato");
    expect(r.confidence).toBe("alta");
  });
});
