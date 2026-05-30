import { formatEnrichedAlert, formatMatchAlert } from "../telegram.alerts";
import type { EnrichedAlertData } from "../telegram.alerts";
import type { DocumentLink } from "../../collectors/comprasmx-detail/index";
import type { DownloadResult } from "../../services/document-downloader";
import type { EnrichedAlert, NormalizedProcurement } from "../../types/procurement";

function makeDocLink(title: string): DocumentLink {
  return {
    documentTitle: title,
    fileName: `${title.toLowerCase().replace(/\s/g, "_")}.pdf`,
    fileUrl: `https://example.com/${title}.pdf`,
    fileType: "pdf",
    source: "ComprasMX",
    discoveredAt: "2026-05-07T00:00:00Z",
    documentHint: "convocatoria",
    isDownloadable: true,
  };
}

function makeDownloadResult(fileUrl: string, status: "ok" | "failed"): DownloadResult {
  return {
    fileUrl,
    fileName: fileUrl.split("/").pop() ?? "file.pdf",
    fileType: "pdf",
    sha256Hash: status === "ok" ? "abc123" : null,
    downloadStatus: status,
    sizeBytes: status === "ok" ? 1024 : null,
    localPath: status === "ok" ? "/tmp/radar-docs/abc123.pdf" : null,
    errorMessage: status === "ok" ? null : "Timeout",
    downloadedAt: "2026-05-07T00:00:00Z",
  };
}

const baseData: EnrichedAlertData = {
  procedureNumber: "CAPUFE-2026-LO-001",
  expedienteId: "EXP-2026-001",
  title: "Mantenimiento correctivo de casetas de peaje",
  dependency: "CAPUFE",
  scope: "NATIONAL_CAPUFE_DESIERTA",
  documentsFound: [],
  documentsDownloaded: [],
  errors: [],
};

describe("formatEnrichedAlert", () => {
  it("sin documentos → mensaje corto con 'sin documentos públicos'", () => {
    const msg = formatEnrichedAlert({ ...baseData });

    expect(msg).toContain("CAPUFE-2026-LO-001");
    expect(msg).toContain("sin documentos públicos");
    expect(msg).not.toContain("Documentos encontrados");
  });

  it("con documentos → incluye sección documentos y conteo", () => {
    const doc = makeDocLink("Bases del procedimiento");
    const dl = makeDownloadResult(doc.fileUrl, "ok");
    const msg = formatEnrichedAlert({
      ...baseData,
      documentsFound: [doc],
      documentsDownloaded: [dl],
    });

    expect(msg).toContain("Documentos encontrados (1)");
    expect(msg).toContain("Bases del procedimiento");
    expect(msg).toContain("✅");
  });

  it("documento con descarga fallida → ⚠️ marker en línea del documento", () => {
    const doc = makeDocLink("Anexo Técnico");
    const dl = makeDownloadResult(doc.fileUrl, "failed");
    const msg = formatEnrichedAlert({
      ...baseData,
      documentsFound: [doc],
      documentsDownloaded: [dl],
    });

    // The ⚠️ icon must appear on the same line as the document title
    expect(msg).toMatch(/⚠️.*Anexo Técnico/);
  });

  it("con errores → sección errores presente", () => {
    const msg = formatEnrichedAlert({
      ...baseData,
      errors: ["Timeout en la conexión"],
    });

    expect(msg).toContain("Errores controlados");
    expect(msg).toContain("Timeout en la conexión");
  });

  it("sin errores → sin sección de errores", () => {
    const doc = makeDocLink("Bases");
    const dl = makeDownloadResult(doc.fileUrl, "ok");
    const msg = formatEnrichedAlert({
      ...baseData,
      documentsFound: [doc],
      documentsDownloaded: [dl],
      errors: [],
    });

    expect(msg).not.toContain("Errores controlados");
  });

  it("mensaje siempre contiene disclaimer legal", () => {
    const msg = formatEnrichedAlert(baseData);
    expect(msg).toContain("información pública");
  });

  it("muestra techo presupuestal cuando hasSignals=true", () => {
    const msg = formatEnrichedAlert({
      ...baseData,
      budgetSignal: { hasSignals: true, highestAmount: 1_500_000 },
    });
    expect(msg).toContain("💰");
    expect(msg).toContain("1,500,000");
  });

  it("muestra 'No localizado' cuando hasSignals=false", () => {
    const msg = formatEnrichedAlert({
      ...baseData,
      budgetSignal: { hasSignals: false, highestAmount: null },
    });
    expect(msg).toContain("📊");
    expect(msg).toContain("No localizado");
  });

  it("no muestra sección de techo si budgetSignal es undefined", () => {
    const msg = formatEnrichedAlert({ ...baseData });
    expect(msg).not.toContain("Techo presupuestal");
  });

  it("muestra sección de antecedentes cuando hay contratos", () => {
    const msg = formatEnrichedAlert({
      ...baseData,
      antecedentes: { compranetCount: 3, compranetHighestAmount: 2500000, sipotCount: 1, ocdsCount: 0 },
    });
    expect(msg).toContain("🔎");
    expect(msg).toContain("CompraNet");
    expect(msg).toContain("2,500,000");
  });

  it("muestra 'Sin antecedentes' cuando todos son 0", () => {
    const msg = formatEnrichedAlert({
      ...baseData,
      antecedentes: { compranetCount: 0, compranetHighestAmount: null, sipotCount: 0, ocdsCount: 0 },
    });
    expect(msg).toContain("🔎");
    expect(msg).toContain("Sin antecedentes");
  });

  it("no muestra sección de antecedentes si antecedentes es undefined", () => {
    const msg = formatEnrichedAlert({ ...baseData });
    expect(msg).not.toContain("Antecedentes encontrados");
  });

  it("muestra sección estimación con techo directo", () => {
    const msg = formatEnrichedAlert({
      ...baseData,
      ceilingEstimate: {
        directCeiling: 3000000,
        estimatedMin: null, estimatedMax: null, average: null, median: null,
        confidence: "alta",
        evidence: [],
        explanation: "Techo localizado directamente en documento oficial.",
        legalWarning: "Estimación basada únicamente en información pública. No representa monto oficial salvo que el documento lo indique expresamente.",
      },
    });
    expect(msg).toContain("📈");
    expect(msg).toContain("Techo directo");
    expect(msg).toContain("3,000,000");
  });

  it("muestra rango estimado cuando no hay techo directo", () => {
    const msg = formatEnrichedAlert({
      ...baseData,
      ceilingEstimate: {
        directCeiling: null,
        estimatedMin: 1000000, estimatedMax: 2000000,
        average: 1500000, median: 1500000,
        confidence: "media",
        evidence: [],
        explanation: "Estimación basada en 2 contratos similares.",
        legalWarning: "Estimación basada únicamente en información pública. No representa monto oficial salvo que el documento lo indique expresamente.",
      },
    });
    expect(msg).toContain("Rango estimado");
    expect(msg).toContain("Confianza");
    expect(msg).toContain("Media");
  });

  it("muestra contratos similares cuando similarContracts tiene entradas", () => {
    const msg = formatEnrichedAlert({
      ...baseData,
      similarContracts: [{
        procedureId: "LP-001",
        source: "compranet-historico",
        title: "Mantenimiento vial 2023",
        similarityScore: 0.9,
        reason: "similitud textual",
        awardedAmount: 1500000,
        supplier: "Empresa SA",
        year: 2023,
        evidenceUrl: null,
      }],
    });
    expect(msg).toContain("🔗");
    expect(msg).toContain("Contratos similares");
    expect(msg).toContain("Mantenimiento vial 2023");
  });

  it("no muestra sección estimación si ceilingEstimate es undefined", () => {
    const msg = formatEnrichedAlert({ ...baseData });
    expect(msg).not.toContain("Estimación presupuestal");
    expect(msg).not.toContain("Contratos similares");
  });
});

describe("formatMatchAlert IMSS Morelos", () => {
  it("inicia con prioridad IMSS Morelos e incluye motivo institucional", () => {
    const procurement: NormalizedProcurement = {
      source: "comprasmx",
      sourceUrl: "https://comprasmx.example/proc/1",
      externalId: "PROC-IMSS-MOR-001",
      expedienteId: "EXP-IMSS-MOR-001",
      licitationNumber: "LIC-IMSS-MOR-001",
      procedureNumber: "PROC-IMSS-MOR-001",
      title: "Unidad de Medicina Familiar del IMSS en Cuernavaca adquisición de papelería",
      description: null,
      dependencyName: "Instituto Mexicano del Seguro Social",
      buyingUnit: "OOAD Morelos",
      procedureType: "licitacion_publica",
      status: "activa",
      publicationDate: "2026-05-01T10:00:00Z",
      openingDate: "2026-06-01T10:00:00Z",
      awardDate: null,
      state: "Morelos",
      municipality: "Cuernavaca",
      amount: null,
      currency: "MXN",
      attachments: [],
      canonicalText: "Unidad de Medicina Familiar del IMSS en Cuernavaca adquisición de papelería",
      canonicalFingerprint: "fp",
      lightweightFingerprint: null,
      canonicalHash: null,
      rawJson: {},
      fetchedAt: "2026-05-01T10:00:00Z",
    };
    const alert: EnrichedAlert = {
      alertType: "new_match",
      radarKey: "imss_morelos",
      radarName: "IMSS Morelos — Prioridad total",
      matchLevel: "high",
      matchScore: 1,
      opportunityScore: 1,
      documentScore: 1,
      procurement,
      matchedTerms: ["IMSS", "Cuernavaca"],
      explanation: "Motivo: buyer_imss + territory_morelos.",
      scoreReasons: ["buyer_imss", "territory_morelos", "priority_institutional_radar"],
      territoryMatched: "Cuernavaca",
      hasHistory: false,
      historyCount: 0,
      detectedAt: "2026-05-01T10:00:00Z",
      telegramMessage: "",
    };

    const msg = formatMatchAlert(alert);

    expect(msg.startsWith("🚨 PRIORIDAD IMSS MORELOS")).toBe(true);
    expect(msg).toContain("Se detectó licitación del IMSS en Morelos.");
    expect(msg).toContain("Motivo: buyer_imss + territory_morelos + priority_institutional_radar");
    expect(msg).toContain("Razón del match: IMSS + Morelos");
  });
});
