import { formatEnrichedAlert, formatMatchAlert, formatWhatsAppMatchAlert } from "../telegram.alerts";
import type { EnrichedAlertData } from "../telegram.alerts";
import type { DocumentLink } from "../../collectors/comprasmx-detail/index";
import type { DownloadResult } from "../../services/document-downloader";
import type { EnrichedAlert, NormalizedProcurement, PublicTenderDocument } from "../../types/procurement";

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

function makeProcurement(overrides: Partial<NormalizedProcurement> = {}): NormalizedProcurement {
  return {
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
      ...overrides,
    };
}

function makePublicDoc(name: string, url: string, type = "convocatoria"): PublicTenderDocument {
  return {
    documentName: name,
    documentType: type,
    originalUrl: url,
    publicUrl: url,
    mimeType: "application/pdf",
    fileExtension: "pdf",
    fileSize: 1024,
    sha256Hash: null,
    detectedAt: "2026-06-29T17:20:00Z",
    lastCheckedAt: "2026-06-29T17:21:00Z",
    isAvailable: true,
    source: "ComprasMX",
  };
}

function makeAlert(overrides: Partial<EnrichedAlert> = {}): EnrichedAlert {
  return {
    alertType: "new_match",
    radarKey: "capufe_mantenimiento_equipos",
    radarName: "CAPUFE — Mantenimiento Equipos Peaje/Telepeaje FONADIN",
    matchLevel: "low",
    matchScore: 0.3,
    opportunityScore: 0.9,
    documentScore: 0.7,
    procurement: makeProcurement(),
    matchedTerms: ["mantenimiento preventivo"],
    explanation: "Match LOW (score: 30%) en radar interno.",
    scoreReasons: ["internal_reason"],
    territoryMatched: "Morelos",
    hasHistory: false,
    historyCount: 0,
    detectedAt: "2026-06-29T23:28:00Z",
    telegramMessage: "",
    ...overrides,
  };
}

describe("formatMatchAlert public tender format", () => {
  it("IMSS Guerrero no aparece como CAPUFE ni expone lenguaje de match", () => {
    const alert = makeAlert({
      procurement: makeProcurement({
        procedureType: "unknown",
        dependencyName: "IMSS",
        state: "GUERRERO",
        municipality: null,
        title: "SERVICIO DE MANTENIMIENTO PREVENTIVO Y CORRECTIVO A EQUIPOS ELECTROMÉDICOS",
        licitationNumber: "IA-50-GYR-050GYR001-N-65-2026",
        expedienteId: "E-2026-00069043",
        rawJson: {
          fecha_aclaraciones: "2026-07-07T09:00:00-06:00",
          fecha_apertura: "2026-07-14T09:00:00-06:00",
        },
      }),
      radarName: "CAPUFE — Mantenimiento Equipos Peaje/Telepeaje FONADIN",
      territoryMatched: "Morelos",
    });

    const msg = formatMatchAlert(alert);

    expect(msg.startsWith("🔔 NUEVA LICITACIÓN DETECTADA — INVITACIÓN A CUANDO MENOS TRES PERSONAS")).toBe(true);
    expect(msg).toContain("🏛 IMSS — Guerrero");
    expect(msg).toContain("📌 SERVICIO DE MANTENIMIENTO PREVENTIVO Y CORRECTIVO A EQUIPOS ELECTROMÉDICOS");
    expect(msg).toContain("🏷 Tipo de procedimiento: Invitación a cuando menos tres personas");
    expect(msg).toContain("🏛 Dependencia: IMSS");
    expect(msg).toContain("📍 Ubicación: Guerrero");
    expect(msg).not.toContain("NUEVO MATCH");
    expect(msg).not.toContain("CAPUFE — Mantenimiento Equipos Peaje/Telepeaje FONADIN");
    expect(msg).not.toContain("Razones del Match");
    expect(msg).not.toContain("Match territorial");
    expect(msg).not.toContain("Términos coincidentes");
    expect(msg).not.toContain("términos coincidentes");
    expect(msg).not.toContain("score comercial");
    expect(msg).not.toContain("Potencial comercial");
    expect(msg).not.toContain("Calidad documental");
    expect(msg).not.toContain("radar interno");
  });

  it("CAPUFE real sí puede aparecer como CAPUFE", () => {
    const msg = formatMatchAlert(makeAlert({
      procurement: makeProcurement({
        dependencyName: "CAPUFE",
        state: "MORELOS",
        municipality: null,
        title: "Mantenimiento de equipos de peaje y telepeaje",
      }),
    }));

    expect(msg).toContain("🏛 Dependencia: CAPUFE");
    expect(msg).toContain("📍 Ubicación: Morelos");
  });

  it("preferencia territorial Morelos no reemplaza la ubicación real", () => {
    const msg = formatMatchAlert(makeAlert({
      procurement: makeProcurement({
        dependencyName: "IMSS",
        state: "GUERRERO",
        municipality: null,
      }),
      commercialTerritoryMatched: "Morelos 100%",
      territoryMatched: "Morelos",
    }));

    expect(msg).toContain("🏛 IMSS — Guerrero");
    expect(msg).not.toContain("— IMSS — Morelos");
  });

  it("IA aparece como invitación a cuando menos tres personas", () => {
    const msg = formatMatchAlert(makeAlert({
      procurement: makeProcurement({
        procedureType: "unknown",
        licitationNumber: "IA-50-GYR-050GYR001-N-65-2026",
        procedureNumber: "IA-50-GYR-050GYR001-N-65-2026",
        dependencyName: "IMSS",
        state: "Guerrero",
        municipality: null,
        title: "SERVICIO DE MANTENIMIENTO PREVENTIVO Y CORRECTIVO A EQUIPOS ELECTROMÉDICOS",
      }),
    }));

    expect(msg.startsWith("🔔 NUEVA LICITACIÓN DETECTADA — INVITACIÓN A CUANDO MENOS TRES PERSONAS")).toBe(true);
    expect(msg).toContain("🏷 Tipo de procedimiento: Invitación a cuando menos tres personas");
  });

  it("LA aparece como licitación pública", () => {
    const msg = formatMatchAlert(makeAlert({
      procurement: makeProcurement({
        procedureType: "unknown",
        licitationNumber: "LA-09-J0U-009J0U012-N-7-2026",
        procedureNumber: "LA-09-J0U-009J0U012-N-7-2026",
      }),
    }));

    expect(msg.startsWith("🔔 NUEVA LICITACIÓN DETECTADA — LICITACIÓN PÚBLICA")).toBe(true);
    expect(msg).toContain("🏷 Tipo de procedimiento: Licitación pública");
  });

  it("AA aparece como adjudicación directa", () => {
    const msg = formatMatchAlert(makeAlert({
      procurement: makeProcurement({
        procedureType: "unknown",
        licitationNumber: "AA-50-GYR-050GYR001-N-10-2026",
        procedureNumber: "AA-50-GYR-050GYR001-N-10-2026",
      }),
    }));

    expect(msg.startsWith("🔔 NUEVA LICITACIÓN DETECTADA — ADJUDICACIÓN DIRECTA")).toBe(true);
    expect(msg).toContain("🏷 Tipo de procedimiento: Adjudicación directa");
  });

  it("campo explícito de ComprasMX tiene prioridad sobre inferencia", () => {
    const msg = formatMatchAlert(makeAlert({
      procurement: makeProcurement({
        procedureType: "unknown",
        licitationNumber: "ZZ-50-GYR-050GYR001-N-10-2026",
        procedureNumber: "ZZ-50-GYR-050GYR001-N-10-2026",
        rawJson: {
          tipo_procedimiento: "Licitación pública nacional",
        },
      }),
    }));

    expect(msg.startsWith("🔔 NUEVA LICITACIÓN DETECTADA — LICITACIÓN PÚBLICA NACIONAL")).toBe(true);
    expect(msg).toContain("🏷 Tipo de procedimiento: Licitación pública nacional");
  });

  it("sin tipo disponible muestra tipo no disponible", () => {
    const msg = formatMatchAlert(makeAlert({
      procurement: makeProcurement({
        procedureType: "unknown",
        licitationNumber: "ZZ-50-GYR-050GYR001-N-10-2026",
        procedureNumber: "ZZ-50-GYR-050GYR001-N-10-2026",
        externalId: "ZZ-50-GYR-050GYR001-N-10-2026",
        rawJson: {},
        canonicalText: "servicio sin modalidad visible",
      }),
    }));

    expect(msg.startsWith("🔔 NUEVA LICITACIÓN DETECTADA — TIPO NO DISPONIBLE")).toBe(true);
    expect(msg).toContain("🏷 Tipo de procedimiento: No disponible");
  });

  it("documentos PDF aparecen después del enlace original con URLs visibles", () => {
    const urlOriginal = "https://comprasmx.example/expediente/E-2026-00069043";
    const msg = formatMatchAlert(makeAlert({
      procurement: makeProcurement({ sourceUrl: urlOriginal }),
      publicDocuments: [
        makePublicDoc("Convocatoria", "https://cdn.example/convocatoria.pdf"),
        makePublicDoc("Anexo técnico", "https://cdn.example/anexo-tecnico.pdf", "anexo_tecnico"),
        makePublicDoc("Modelo de contrato", "https://cdn.example/modelo-contrato.pdf", "contrato"),
      ],
    }));

    expect(msg).toContain(`🔗 Ver licitación original:\n${urlOriginal}\n\n📎 Documentos / anexos:`);
    expect(msg).toContain("1. Convocatoria:\n   https://cdn.example/convocatoria.pdf");
    expect(msg).toContain("2. Anexo técnico:\n   https://cdn.example/anexo-tecnico.pdf");
    expect(msg).toContain("3. Modelo de contrato:\n   https://cdn.example/modelo-contrato.pdf");
  });

  it("WhatsApp usa URLs completas visibles y sin markdown oculto", () => {
    const msg = formatWhatsAppMatchAlert(makeAlert({
      publicDocuments: [makePublicDoc("Convocatoria", "https://cdn.example/convocatoria.pdf")],
    }));

    expect(msg).toContain("https://comprasmx.example/proc/1");
    expect(msg).toContain("https://cdn.example/convocatoria.pdf");
    expect(msg).not.toContain("[Convocatoria]");
    expect(msg).not.toContain("<a href=");
  });

  it("sin documentos pero con ficha original no dice documentos no disponibles", () => {
    const msg = formatMatchAlert(makeAlert({ publicDocuments: [] }));
    expect(msg).toContain("📎 Documentos / anexos:");
    expect(msg).toContain("Disponibles desde la ficha original. Abrir el enlace original para consultar los anexos.");
    expect(msg.toLowerCase()).not.toContain("documentos no disponibles");
  });

  it("formato Telegram inicia con 🚨 cuando es prioridad CAPUFE/FONADIN", () => {
    const msg = formatMatchAlert(makeAlert({
      procurement: makeProcurement({
        dependencyName: "CAPUFE",
        state: "Morelos",
        municipality: null,
        title:
          "Contratación del servicio de mantenimiento preventivo y correctivo a equipos de control de tránsito de peaje y telepeaje en las plazas de cobro correspondientes a la Red CAPUFE, Red FONADIN y tramo México-Cuernavaca y Michapa-Puebla.",
        procedureType: "unknown",
        procedureNumber: "LA-09-J0U-009J0U012-N-7-2026",
        licitationNumber: "LA-09-J0U-009J0U012-N-7-2026",
      }),
    }));

    expect(msg.startsWith("🚨 LICITACIÓN PRIORITARIA DETECTADA — Licitación pública")).toBe(true);
    expect(msg).toContain("🎯 Perfil detectado: Mantenimiento Peaje/Telepeaje CAPUFE-FONADIN");
  });

  it("formato prioritario incluye links visibles de anexos", () => {
    const msg = formatMatchAlert(makeAlert({
      procurement: makeProcurement({
        dependencyName: "IMSS",
        state: "Morelos",
        title:
          "Adquisición de bienes terapéuticos del grupo material de laboratorio y reactivos para cubrir las necesidades de los laboratorios del IMSS en el estado de Morelos.",
      }),
      publicDocuments: [
        makePublicDoc("Anexo técnico", "https://comprasmx.example/anexos/anexo-tecnico.pdf", "anexo_tecnico"),
      ],
    }));

    expect(msg.startsWith("🚨 LICITACIÓN PRIORITARIA DETECTADA")).toBe(true);
    expect(msg).toContain("📎 Documentos / anexos:");
    expect(msg).toContain("1. Anexo técnico:\n   https://comprasmx.example/anexos/anexo-tecnico.pdf");
  });
});
