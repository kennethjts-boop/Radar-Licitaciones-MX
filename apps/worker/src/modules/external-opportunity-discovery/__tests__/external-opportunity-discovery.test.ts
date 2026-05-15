import {
  buildExternalLeadFingerprint,
  dedupeExternalLeadCandidates,
  findMatchedBusinessKeywords,
  isExternalLeadInAllowedScope,
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

  it("descarta correos personales aunque estén en fuente oficial", () => {
    const contact = sanitizePublicContact({
      sourceUrl: "https://www.morelos.gob.mx/directorio",
      contactArea: "adquisiciones",
      contactNamePublicOptional: "Contacto Institucional",
      contactEmailPublicOptional: "contacto@gmail.com",
      contactPhonePublicOptional: "7770000000",
    });

    expect(contact.contactArea).toBe("adquisiciones");
    expect(contact.contactNamePublicOptional).toBe("Contacto Institucional");
    expect(contact.contactEmailPublicOptional).toBeNull();
    expect(contact.contactPhonePublicOptional).toBe("7770000000");
  });

  it("descarta contacto no institucional aunque venga de fuente oficial", () => {
    const contact = sanitizePublicContact({
      sourceUrl: "https://www.morelos.gob.mx/directorio",
      contactArea: "adquisiciones",
      contactNamePublicOptional: "Contacto Publicado",
      contactEmailPublicOptional: "contacto@empresa.com",
      contactPhonePublicOptional: "7770000000",
    });

    expect(contact.contactArea).toBe("adquisiciones");
    expect(contact.contactNamePublicOptional).toBe("Contacto Publicado");
    expect(contact.contactEmailPublicOptional).toBeNull();
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
    expect(upsertLead).not.toHaveBeenCalled();
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
