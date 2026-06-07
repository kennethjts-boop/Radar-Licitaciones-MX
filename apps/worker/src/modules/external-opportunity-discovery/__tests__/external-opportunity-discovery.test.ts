import {
  buildExternalLeadFingerprint,
  buildExternalLead,
  dedupeExternalLeadCandidates,
  findMatchedBusinessKeywords,
  isExternalLeadInAllowedScope,
  redactSensitivePublicData,
  runExternalLeadsOsintJob,
  sanitizePublicContact,
  scoreExternalLead,
  shouldAlertExternalLead,
} from "..";
import { resetConfig } from "../../../config/env";
import { runExternalLeadsIfEnabled } from "../../../jobs/scheduler";
import { BUSINESS_LINE_KEYWORDS } from "../keywords";
import type { ExternalLeadCandidate, ExternalLeadRunOptions } from "../types";

function businessLine(key: ExternalLeadCandidate["vertical"]) {
  const config = BUSINESS_LINE_KEYWORDS.find((item) => item.key === key);
  if (!config) throw new Error(`missing business line ${key}`);
  return config;
}

function makeCandidate(
  overrides: Partial<ExternalLeadCandidate> = {},
): ExternalLeadCandidate {
  return {
    sourceName: "datos.gob.mx",
    sourceUrl: "https://datos.gob.mx/busca/dataset/contratos-morelos",
    detectedAt: new Date().toISOString(),
    title: "Licitación abierta para suministro de aceites industriales",
    organizationName: "Ayuntamiento de Cuernavaca",
    organizationType: "municipio",
    state: "Morelos",
    municipality: "Cuernavaca",
    sector: "Aceites / Lubricantes",
    vertical: "aceites_lubricantes",
    matchedKeywords: ["aceite industrial", "suministro de aceites"],
    evidenceText:
      "Convocatoria pública del Ayuntamiento de Cuernavaca para suministro de aceites industriales y lubricantes para parque vehicular.",
    contactArea: "adquisiciones",
    contactNamePublicOptional: null,
    contactEmailPublicOptional: null,
    contactPhonePublicOptional: null,
    opportunityType: "licitacion",
    amountVisible: false,
    buyerAreaIdentified: true,
    isOfficialSource: true,
    sourcePublishedAt: new Date().toISOString(),
    raw: {},
    ...overrides,
  };
}

describe("external-opportunity-discovery matching", () => {
  it("normaliza keywords con acentos y singular/plural", () => {
    const matches = findMatchedBusinessKeywords(
      "Se solicitan evaluaciones psicometricas y validacion de documentos",
      businessLine("seguridad_confianza_riesgo"),
    );

    expect(matches).toContain("evaluación psicométrica");
    expect(matches).toContain("validación de documentos");
  });

  it("deduplica candidatos por fingerprint estable", () => {
    const one = makeCandidate();
    const two = makeCandidate({ evidenceText: "Texto distinto de la misma fuente" });

    expect(buildExternalLeadFingerprint(one)).toBe(buildExternalLeadFingerprint(two));
    expect(dedupeExternalLeadCandidates([one, two])).toHaveLength(1);
  });

  it("respeta alcance Morelos/CAPUFE", () => {
    const capufeNational = makeCandidate({
      sourceUrl: "https://datos.gob.mx/busca/dataset/contratos-capufe",
      organizationName: "CAPUFE",
      state: "NACIONAL",
      municipality: null,
      title: "Suministro de lubricantes CAPUFE",
      evidenceText: "CAPUFE suministro de lubricantes para flotilla nacional",
    });
    const capufeOpportunity = makeCandidate({
      ...capufeNational,
      title: "Licitación desierta CAPUFE",
      evidenceText:
        "CAPUFE licitación desierta sin participantes para suministro de lubricantes",
    });

    expect(isExternalLeadInAllowedScope(capufeNational, true)).toBe(false);
    expect(isExternalLeadInAllowedScope(capufeNational, false)).toBe(false);
    expect(isExternalLeadInAllowedScope(capufeOpportunity, false)).toBe(true);
  });

  it("acepta ubicaciones objetivo con Morelos y Jalisco", () => {
    const jaliscoLead = makeCandidate({
      sourceUrl: "https://datos.gob.mx/busca/dataset/contratos-jalisco",
      organizationName: "Gobierno de Jalisco",
      state: "Jalisco",
      municipality: "Zapopan",
      title: "Contrato de lubricantes para parque vehicular",
      evidenceText: "Gobierno de Jalisco publica contrato para aceites y lubricantes.",
    });

    const outsideLead = makeCandidate({
      sourceUrl: "https://datos.gob.mx/busca/dataset/contratos-puebla",
      organizationName: "Gobierno de Puebla",
      state: "Puebla",
      municipality: "Puebla",
      title: "Contrato de lubricantes para parque vehicular",
      evidenceText: "Gobierno de Puebla publica contrato para aceites y lubricantes.",
    });

    expect(isExternalLeadInAllowedScope(jaliscoLead, true, ["morelos", "jalisco"])).toBe(true);
    expect(isExternalLeadInAllowedScope(outsideLead, true, ["morelos", "jalisco"])).toBe(false);
  });

  it("detecta Guadalajara aunque state venga vacío", () => {
    const lead = makeCandidate({
      sourceUrl: "https://datos.gob.mx/busca/dataset/guadalajara-adquisiciones",
      organizationName: "Dirección de Adquisiciones de Guadalajara",
      state: null,
      municipality: null,
      title: "Suministro de aceites para servicios municipales",
      evidenceText: "Convocatoria pública del Ayuntamiento de Guadalajara para parque vehicular.",
    });

    expect(isExternalLeadInAllowedScope(lead, true, ["jalisco"])).toBe(true);
  });

  it("detecta CDMX por Ciudad de México", () => {
    const lead = makeCandidate({
      sourceUrl: "https://datos.gob.mx/busca/dataset/ciudad-de-mexico-compras",
      organizationName: "Gobierno de la Ciudad de México",
      state: null,
      municipality: null,
      title: "Contrato de impresos institucionales",
      evidenceText: "Proceso de adquisiciones para alcaldía en Ciudad de México.",
    });

    expect(isExternalLeadInAllowedScope(lead, true, ["cdmx"])).toBe(true);
  });

  it("detecta Estado de México por Edomex", () => {
    const lead = makeCandidate({
      sourceUrl: "https://datos.gob.mx/busca/dataset/edomex-adquisiciones",
      organizationName: "Secretaría de Administración Edomex",
      state: null,
      municipality: null,
      title: "Contrato de mantenimiento institucional",
      evidenceText: "Edomex publica contrato para mantenimiento de oficinas públicas.",
    });

    expect(isExternalLeadInAllowedScope(lead, true, ["estado-de-mexico"])).toBe(true);
  });

  it("si target locations existe, no depende de EXTERNAL_LEADS_MORELOS_ONLY", () => {
    const lead = makeCandidate({
      sourceUrl: "https://datos.gob.mx/busca/dataset/tlaquepaque-compras",
      organizationName: "San Pedro Tlaquepaque",
      state: null,
      municipality: null,
      title: "Contrato de impresos institucionales",
      evidenceText: "San Pedro Tlaquepaque publica adquisiciones para impresos.",
    });

    expect(isExternalLeadInAllowedScope(lead, true, ["guadalajara"])).toBe(true);
    expect(isExternalLeadInAllowedScope(lead, false, ["guadalajara"])).toBe(true);
  });

  it("si no existe target locations, mantiene Morelos only actual", () => {
    const morelosLead = makeCandidate();
    const jaliscoLead = makeCandidate({
      sourceUrl: "https://datos.gob.mx/busca/dataset/jalisco-adquisiciones",
      organizationName: "Gobierno de Jalisco",
      state: "Jalisco",
      municipality: "Zapopan",
      title: "Contrato de lubricantes para parque vehicular",
      evidenceText: "Gobierno de Jalisco publica contrato para aceites y lubricantes.",
    });

    expect(isExternalLeadInAllowedScope(morelosLead, true)).toBe(true);
    expect(isExternalLeadInAllowedScope(jaliscoLead, true)).toBe(false);
  });
});

describe("external-opportunity-discovery scoring and contacts", () => {
  it("mantiene score conservador y no marca 100 por una sola keyword", () => {
    const result = scoreExternalLead(
      makeCandidate({ matchedKeywords: ["aceite"], amountVisible: true }),
      180,
    );

    expect(result.score).toBeLessThanOrEqual(55);
    expect(result.score).toBeGreaterThan(0);
  });

  it("no alerta debajo del score mínimo", () => {
    expect(shouldAlertExternalLead(44, 45)).toBe(false);
    expect(shouldAlertExternalLead(45, 45)).toBe(true);
    expect(shouldAlertExternalLead(30, 10, "LOW")).toBe(false);
  });

  it("no conserva contacto personal si la fuente no es oficial", () => {
    const contact = sanitizePublicContact({
      sourceUrl: "https://example.com/directorio",
      contactArea: "compras",
      contactNamePublicOptional: "Persona Pública",
      contactEmailPublicOptional: "persona@gmail.com",
      contactPhonePublicOptional: "7770000000",
    });

    expect(contact).toEqual({
      contactArea: null,
      contactNamePublicOptional: null,
      contactEmailPublicOptional: null,
      contactPhonePublicOptional: null,
    });
  });

  it("no persiste nombre, email ni teléfono aunque estén en fuente oficial", () => {
    const contact = sanitizePublicContact({
      sourceUrl: "https://www.morelos.gob.mx/directorio",
      contactArea: "adquisiciones",
      contactNamePublicOptional: "Contacto Institucional",
      contactEmailPublicOptional: "contacto@morelos.gob.mx",
      contactPhonePublicOptional: "7770000000",
    });

    expect(contact.contactArea).toBe("adquisiciones");
    expect(contact.contactNamePublicOptional).toBeNull();
    expect(contact.contactEmailPublicOptional).toBeNull();
    expect(contact.contactPhonePublicOptional).toBeNull();
  });

  it("descarta contacto personal aunque venga de fuente oficial", () => {
    const contact = sanitizePublicContact({
      sourceUrl: "https://www.morelos.gob.mx/directorio",
      contactArea: "adquisiciones",
      contactNamePublicOptional: "Contacto Publicado",
      contactEmailPublicOptional: "contacto@empresa.com",
      contactPhonePublicOptional: "7770000000",
    });

    expect(contact.contactArea).toBe("adquisiciones");
    expect(contact.contactNamePublicOptional).toBeNull();
    expect(contact.contactEmailPublicOptional).toBeNull();
    expect(contact.contactPhonePublicOptional).toBeNull();
  });

  it("deja contacto null si no hay área institucional clara", () => {
    const contact = sanitizePublicContact({
      sourceUrl: "https://www.morelos.gob.mx/directorio",
      contactArea: null,
      contactNamePublicOptional: "Contacto Publicado",
      contactEmailPublicOptional: "compras@morelos.gob.mx",
      contactPhonePublicOptional: "7770000000",
    });

    expect(contact).toEqual({
      contactArea: null,
      contactNamePublicOptional: null,
      contactEmailPublicOptional: null,
      contactPhonePublicOptional: null,
    });
  });

  it("mantiene contrato histórico en MEDIUM salvo evidencia fuerte", () => {
    const result = scoreExternalLead(
      makeCandidate({
        opportunityType: "contrato_historico",
        matchedKeywords: ["aceite", "lubricante"],
        amountVisible: true,
      }),
      180,
    );

    expect(result.confidence).toBe("MEDIUM");
    expect(result.score).toBeLessThan(75);
  });

  it("mantiene señal comercial genérica en LOW", () => {
    const result = scoreExternalLead(
      makeCandidate({
        opportunityType: "senal_comercial_publica",
        state: null,
        municipality: null,
        matchedKeywords: ["aceite"],
        amountVisible: false,
        buyerAreaIdentified: false,
        contactArea: null,
        isOfficialSource: true,
        evidenceText: "Mención pública genérica de aceite",
      }),
      180,
    );

    expect(result.confidence).toBe("LOW");
  });

  it("sube score para licitación de construcción/mantenimiento con evidencia oficial", () => {
    const result = scoreExternalLead(
      makeCandidate({
        title: "Municipio licita mantenimiento y rehabilitación de edificios públicos",
        vertical: "construccion_mantenimiento",
        matchedKeywords: ["mantenimiento", "rehabilitación", "edificios públicos"],
        evidenceText:
          "Convocatoria pública para licitación de obra pública, mantenimiento, rehabilitación y construcción de infraestructura municipal en Morelos.",
        opportunityType: "licitacion",
        organizationName: "Ayuntamiento de Cuernavaca",
        state: "Morelos",
        municipality: "Cuernavaca",
        isOfficialSource: true,
        buyerAreaIdentified: true,
      }),
      180,
    );

    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.confidence).not.toBe("LOW");
    expect(result.scoreBreakdown.procurementIntentScore).toBeGreaterThan(0);
  });

  it("descarta nota social o médica institucional sin oportunidad comercial", () => {
    const result = scoreExternalLead(
      makeCandidate({
        title: "IMSS informa bebé nacido y jornada médica para pacientes",
        matchedKeywords: ["mantenimiento"],
        evidenceText:
          "Comunicado social del IMSS sobre bebé nacido, cirugía, jornada médica, pacientes y salud preventiva.",
        opportunityType: "senal_comercial_publica",
        amountVisible: false,
        buyerAreaIdentified: false,
        contactArea: null,
        isOfficialSource: true,
      }),
      180,
    );

    expect(result.score).toBeLessThan(45);
    expect(result.confidence).toBe("LOW");
    expect(result.scoreBreakdown.negativePenalty).toBeGreaterThan(0);
    expect(result.scoreReasons.join(" ")).toContain("institutional noise");
  });

  it("redacta correos y teléfonos antes de persistir evidencia", () => {
    expect(
      redactSensitivePublicData(
        "Contacto compras@morelos.gob.mx, telefono +52 777 123 4567 y 7770000000",
      ),
    ).toBe(
      "Contacto [REDACTED_EMAIL], telefono [REDACTED_PHONE] y [REDACTED_PHONE]",
    );

    const lead = buildExternalLead(
      makeCandidate({
        title: "Convocatoria compras@morelos.gob.mx",
        evidenceText: "Informes al correo compras@morelos.gob.mx o al 7770000000.",
      }),
      180,
    );

    expect(lead.title).toBe("Convocatoria [REDACTED_EMAIL]");
    expect(lead.evidenceText).toBe(
      "Informes al correo [REDACTED_EMAIL] o al [REDACTED_PHONE].",
    );
  });
});

describe("external-opportunity-discovery job hardening", () => {
  const baseOptions: ExternalLeadRunOptions = {
    enabled: true,
    dryRun: true,
    maxResultsPerRun: 5,
    minScore: 45,
    lookbackDays: 180,
    morelosOnly: true,
    telegramEnabled: true,
    discoveryMode: false,
    debugDiscards: true,
    saveLowScoreCandidates: false,
    maxRawResultsPerSource: 50,
    sourceTimeoutMs: 15000,
    debugCandidates: false,
  };

  it("dry-run no guarda ni alerta", async () => {
    const upsertLead = jest.fn();
    const sendAlert = jest.fn();

    const result = await runExternalLeadsOsintJob(baseOptions, {
      discoverCandidates: async () => ({
        candidates: [makeCandidate()],
        errors: [],
        errorsBySource: {},
        sourcesReviewed: 1,
      }),
      upsertLead,
      sendAlert,
      recordState: async () => {},
    });

    expect(result.dryRun).toBe(true);
    expect(result.telegramCandidates).toBe(1);
    expect(result.saved).toBe(0);
    expect(result.alerted).toBe(0);
    expect(upsertLead).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("Telegram apagado no alerta pero sí guarda si no es dry-run", async () => {
    const createAlert = jest.fn();
    const sendAlert = jest.fn();

    const result = await runExternalLeadsOsintJob(
      { ...baseOptions, dryRun: false, telegramEnabled: false },
      {
        discoverCandidates: async () => ({
          candidates: [makeCandidate()],
          errors: [],
          errorsBySource: {},
          sourcesReviewed: 1,
        }),
        upsertLead: async () => ({ id: "lead-1", isNew: true }),
        createAlert,
        sendAlert,
        recordState: async () => {},
      },
    );

    expect(result.saved).toBe(1);
    expect(result.alerted).toBe(0);
    expect(createAlert).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("evita duplicados si external_lead_alerts ya tiene fingerprint", async () => {
    const createAlert = jest.fn();
    const sendAlert = jest.fn();

    const result = await runExternalLeadsOsintJob(
      { ...baseOptions, dryRun: false, telegramEnabled: true },
      {
        discoverCandidates: async () => ({
          candidates: [makeCandidate()],
          errors: [],
          errorsBySource: {},
          sourcesReviewed: 1,
        }),
        upsertLead: async () => ({ id: "lead-1", isNew: false }),
        hasAlert: async () => true,
        createAlert,
        sendAlert,
        recordState: async () => {},
      },
    );

    expect(result.saved).toBe(1);
    expect(result.skippedDuplicateAlert).toBe(1);
    expect(createAlert).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("envía alerta cuando pasa filtros y no está duplicada", async () => {
    const sendAlert = jest.fn(async () => 123);
    const markSent = jest.fn(async () => {});

    const result = await runExternalLeadsOsintJob(
      { ...baseOptions, dryRun: false, telegramEnabled: true },
      {
        discoverCandidates: async () => ({
          candidates: [makeCandidate()],
          errors: [],
          errorsBySource: {},
          sourcesReviewed: 1,
        }),
        upsertLead: async () => ({ id: "lead-1", isNew: true }),
        hasAlert: async () => false,
        createAlert: async () => "alert-1",
        sendAlert,
        markSent,
        recordState: async () => {},
      },
    );

    expect(result.alerted).toBe(1);
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledWith("alert-1", "lead-1", 123);
  });

  it("score bajo no guarda ni alerta", async () => {
    const upsertLead = jest.fn();
    const lowCandidate = makeCandidate({
      opportunityType: "senal_comercial_publica",
      state: null,
      municipality: null,
      matchedKeywords: ["aceite"],
      evidenceText: "aceite",
      amountVisible: false,
      buyerAreaIdentified: false,
      contactArea: null,
      isOfficialSource: false,
    });

    const result = await runExternalLeadsOsintJob(
      { ...baseOptions, dryRun: false },
      {
        discoverCandidates: async () => ({
          candidates: [lowCandidate],
          errors: [],
          errorsBySource: {},
          sourcesReviewed: 1,
        }),
        upsertLead,
        recordState: async () => {},
      },
    );

    expect(result.skippedLowScore).toBe(1);
    expect(result.topDiscardedCandidates[0]?.scoreBreakdown).toBeDefined();
    expect(result.topDiscardedCandidates[0]?.minScore).toBe(baseOptions.minScore);
    expect(upsertLead).not.toHaveBeenCalled();
  });

  it("RADAR_DEBUG_CANDIDATES no envía alertas extra para descartados", async () => {
    const sendAlert = jest.fn();
    const lowCandidate = makeCandidate({
      opportunityType: "senal_comercial_publica",
      matchedKeywords: ["aceite"],
      evidenceText: "bebé nacido y jornada médica sin contrato vigente",
      amountVisible: false,
      buyerAreaIdentified: false,
      contactArea: null,
      isOfficialSource: true,
    });

    const result = await runExternalLeadsOsintJob(
      { ...baseOptions, dryRun: false, debugCandidates: true },
      {
        discoverCandidates: async () => ({
          candidates: [lowCandidate],
          errors: [],
          errorsBySource: {},
          sourcesReviewed: 1,
        }),
        sendAlert,
        recordState: async () => {},
      },
    );

    expect(result.skippedLowScore).toBe(1);
    expect(result.alerted).toBe(0);
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("EXTERNAL_LEADS_SAVE_LOW_SCORE_CANDIDATES guarda diagnóstico sin mandar Telegram", async () => {
    const upsertLead = jest.fn(async () => ({ id: "lead-low", isNew: true }));
    const sendAlert = jest.fn();
    const lowCandidate = makeCandidate({
      opportunityType: "senal_comercial_publica",
      state: null,
      municipality: null,
      matchedKeywords: ["aceite"],
      evidenceText: "Mención pública genérica de aceite sin licitación ni contrato",
      amountVisible: false,
      buyerAreaIdentified: false,
      contactArea: null,
      isOfficialSource: false,
    });

    const result = await runExternalLeadsOsintJob(
      {
        ...baseOptions,
        dryRun: false,
        saveLowScoreCandidates: true,
        telegramEnabled: true,
      },
      {
        discoverCandidates: async () => ({
          candidates: [lowCandidate],
          errors: [],
          errorsBySource: {},
          sourcesReviewed: 1,
        }),
        upsertLead,
        sendAlert,
        recordState: async () => {},
      },
    );

    expect(result.skippedLowScore).toBe(1);
    expect(result.saved).toBe(1);
    expect(upsertLead).toHaveBeenCalledWith(
      expect.objectContaining({ status: "diagnostic_low_score" }),
    );
    expect(result.alerted).toBe(0);
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("lead sin source_url se descarta", async () => {
    const result = await runExternalLeadsOsintJob(baseOptions, {
      discoverCandidates: async () => ({
        candidates: [makeCandidate({ sourceUrl: "" })],
        errors: [],
        errorsBySource: {},
        sourcesReviewed: 1,
      }),
      recordState: async () => {},
    });

    expect(result.skippedMissingSourceUrl).toBe(1);
    expect(result.telegramCandidates).toBe(0);
  });

  it("lead sin evidence_text se descarta", async () => {
    const result = await runExternalLeadsOsintJob(baseOptions, {
      discoverCandidates: async () => ({
        candidates: [makeCandidate({ evidenceText: "" })],
        errors: [],
        errorsBySource: {},
        sourcesReviewed: 1,
      }),
      recordState: async () => {},
    });

    expect(result.skippedMissingEvidence).toBe(1);
    expect(result.telegramCandidates).toBe(0);
  });

  it("fallo del módulo externo no rompe scheduler principal", async () => {
    process.env.ENABLE_EXTERNAL_LEADS_OSINT = "true";
    resetConfig();

    await expect(
      runExternalLeadsIfEnabled(async () => {
        throw new Error("fallo externo");
      }),
    ).resolves.toBeUndefined();

    process.env.ENABLE_EXTERNAL_LEADS_OSINT = "false";
    resetConfig();
  });
});
