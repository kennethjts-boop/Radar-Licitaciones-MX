import {
  evaluateProcurementAgainstRadar,
  evaluateAllRadars,
} from "../matcher";
import { getActiveRadars, getRadarByKey } from "../../radars";
import type { NormalizedProcurement, RadarConfig } from "../../types/procurement";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProcurement(overrides: Partial<NormalizedProcurement> = {}): NormalizedProcurement {
  return {
    source: "comprasmx",
    externalId: "TEST-001",
    expedienteId: "EXP-001",
    licitationNumber: "LIC-001",
    procedureNumber: "PROC-001",
    title: "Servicio de mantenimiento de casetas de peaje CAPUFE",
    description: "Contrato de mantenimiento correctivo de equipos en casetas",
    canonicalText: "servicio mantenimiento casetas peaje capufe contrato equipos",
    dependencyName: "CAPUFE",
    buyingUnit: "Administración Central",
    procedureType: "licitacion_publica",
    status: "activa",
    state: "Ciudad de México",
    municipality: null,
    amount: 1000000,
    currency: "MXN",
    publicationDate: "2026-01-01",
    openingDate: null,
    awardDate: null,
    sourceUrl: "https://example.com/exp/001",
    attachments: [],
    canonicalFingerprint: "abc123",
    lightweightFingerprint: "def456",
    rawJson: {},
    fetchedAt: new Date().toISOString(),
    canonicalHash: null,
    ...overrides,
  };
}

function makeRadar(overrides: Partial<RadarConfig> = {}): RadarConfig {
  return {
    key: "test-radar",
    name: "Test Radar",
    description: "Radar de prueba",
    isActive: true,
    priority: 1,
    scheduleMinutes: 30,
    includeTerms: ["capufe", "peaje"],
    excludeTerms: [],
    geoTerms: [],
    entityTerms: [],
    rules: [],
    minScore: 0.3,
    ...overrides,
  };
}

// ── evaluateProcurementAgainstRadar ───────────────────────────────────────────

describe("evaluateProcurementAgainstRadar", () => {
  it("retorna match cuando términos están presentes", () => {
    const proc = makeProcurement();
    const radar = makeRadar();
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result).not.toBeNull();
    expect(result!.matchScore).toBeGreaterThan(0);
    expect(result!.matchedTerms).toContain("capufe");
    expect(result!.matchedTerms).toContain("peaje");
  });

  it("retorna null cuando no hay términos incluidos en el texto", () => {
    const proc = makeProcurement({ canonicalText: "contrato de limpieza hospitalaria" });
    const radar = makeRadar({ includeTerms: ["capufe", "peaje"] });
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result).toBeNull();
  });

  it("penaliza score cuando hay términos excluidos", () => {
    const proc = makeProcurement({
      canonicalText: "capufe peaje cancelado suspendido",
    });
    const radarSinExclusiones = makeRadar({ excludeTerms: [] });
    const radarConExclusiones = makeRadar({ excludeTerms: ["cancelado", "suspendido"] });

    const resultSin = evaluateProcurementAgainstRadar(proc, radarSinExclusiones, true);
    const resultCon = evaluateProcurementAgainstRadar(proc, radarConExclusiones, true);

    expect(resultSin).not.toBeNull();
    expect(resultCon).not.toBeNull();
    expect(resultCon!.matchScore).toBeLessThan(resultSin!.matchScore);
  });

  it("retorna null si score penalizado no supera minScore", () => {
    const proc = makeProcurement({
      canonicalText: "capufe peaje cancelado desierto suspendido",
    });
    const radar = makeRadar({
      includeTerms: ["capufe"],
      excludeTerms: ["cancelado", "desierto", "suspendido"],
      minScore: 0.9,
    });
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result).toBeNull();
  });

  it("evalúa regla 'contains' required correctamente — pasa", () => {
    const proc = makeProcurement({ dependencyName: "CAPUFE" });
    const radar = makeRadar({
      includeTerms: ["peaje"],
      rules: [
        {
          ruleType: "entity",
          fieldName: "dependency_name",
          operator: "contains",
          value: "capufe",
          isRequired: true,
          weight: 1,
        },
      ],
    });
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result).not.toBeNull();
  });

  it("retorna null si regla required no se cumple", () => {
    const proc = makeProcurement({ dependencyName: "IMSS" });
    const radar = makeRadar({
      includeTerms: ["peaje"],
      rules: [
        {
          ruleType: "entity",
          fieldName: "dependency_name",
          operator: "contains",
          value: "capufe",
          isRequired: true,
          weight: 1,
        },
      ],
    });
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result).toBeNull();
  });

  it("evalúa regla 'any_of' correctamente", () => {
    const proc = makeProcurement({ state: "Morelos" });
    const radar = makeRadar({
      includeTerms: ["mantenimiento"],
      rules: [
        {
          ruleType: "geo",
          fieldName: "state",
          operator: "any_of",
          value: ["Morelos", "CDMX", "Jalisco"],
          isRequired: true,
          weight: 1,
        },
      ],
    });
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result).not.toBeNull();
  });

  it("evalúa regla 'none_of' correctamente — falla si el valor está presente", () => {
    const proc = makeProcurement({ status: "cancelada" });
    const radar = makeRadar({
      includeTerms: ["capufe"],
      rules: [
        {
          ruleType: "status",
          fieldName: "status",
          operator: "none_of",
          value: ["cancelada", "desierta"],
          isRequired: true,
          weight: 1,
        },
      ],
    });
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result).toBeNull();
  });

  it("marca isNew correctamente", () => {
    const proc = makeProcurement();
    const radar = makeRadar();
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result!.isNew).toBe(true);
  });

  it("detecta cambio de status correctamente", () => {
    const proc = makeProcurement({ status: "adjudicada" });
    const radar = makeRadar();
    const result = evaluateProcurementAgainstRadar(proc, radar, false, "activa");
    expect(result!.isStatusChange).toBe(true);
    expect(result!.previousStatus).toBe("activa");
  });

  it("matchScore está entre 0 y 1", () => {
    const proc = makeProcurement();
    const radar = makeRadar();
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result!.matchScore).toBeGreaterThanOrEqual(0);
    expect(result!.matchScore).toBeLessThanOrEqual(1);
  });

  it("calcula opportunityScore y documentScore entre 0 y 1", () => {
    const proc = makeProcurement({
      attachments: [{
        fileName: "bases.pdf",
        fileType: "pdf",
        fileUrl: "https://example.com/bases.pdf",
        fileHash: null,
        detectedText: null,
      }],
    });
    const radar = makeRadar();
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(result!.opportunityScore).toBeGreaterThanOrEqual(0);
    expect(result!.opportunityScore).toBeLessThanOrEqual(1);
    expect(result!.documentScore).toBeGreaterThanOrEqual(0);
    expect(result!.documentScore).toBeLessThanOrEqual(1);
    expect(result!.documentScore).toBeGreaterThan(0.2);
  });

  it("matchLevel es high/medium/low según el score", () => {
    const proc = makeProcurement();
    const radar = makeRadar();
    const result = evaluateProcurementAgainstRadar(proc, radar, true);
    expect(["high", "medium", "low"]).toContain(result!.matchLevel);
  });
});

// ── evaluateAllRadars ─────────────────────────────────────────────────────────

describe("evaluateAllRadars", () => {
  it("evalúa múltiples radares y retorna todos los matches", () => {
    const proc = makeProcurement({
      canonicalText: "capufe peaje mantenimiento imss morelos contrato",
    });
    const radars = [
      makeRadar({ key: "capufe", includeTerms: ["capufe", "peaje"] }),
      makeRadar({ key: "imss-morelos", includeTerms: ["imss", "morelos"] }),
    ];
    const results = evaluateAllRadars(proc, radars, true);
    expect(results).toHaveLength(2);
    const keys = results.map((r) => r.radarKey);
    expect(keys).toContain("capufe");
    expect(keys).toContain("imss-morelos");
  });

  it("omite radares inactivos", () => {
    const proc = makeProcurement();
    const radars = [
      makeRadar({ key: "activo", isActive: true }),
      makeRadar({ key: "inactivo", isActive: false }),
    ];
    const results = evaluateAllRadars(proc, radars, true);
    expect(results.length).toBe(1);
    expect(results[0].radarKey).toBe("activo");
  });

  it("retorna array vacío si no hay matches", () => {
    const proc = makeProcurement({ canonicalText: "limpieza hospitalaria cdmx" });
    const radars = [makeRadar({ includeTerms: ["capufe", "peaje"] })];
    const results = evaluateAllRadars(proc, radars, true);
    expect(results).toHaveLength(0);
  });

  it("retorna array vacío si no hay radares", () => {
    const proc = makeProcurement();
    const results = evaluateAllRadars(proc, [], true);
    expect(results).toHaveLength(0);
  });
});

describe("business line radars", () => {
  it("mantiene activos radares existentes y agrega nuevas verticales", () => {
    const keys = getActiveRadars().map((radar) => radar.key);
    expect(keys).toContain("capufe_oportunidades");
    expect(keys).toContain("capufe_direct_awards");
    expect(keys).toContain("imss_morelos");
    expect(keys).toContain("hm_highmil_lubricantes_morelos");
    expect(keys).toContain("primasa_impresos_morelos");
    expect(keys).toContain("coformex_impresos_morelos");
    expect(keys).toContain("uniforce_seguridad_riesgo_morelos");
    expect(keys).toContain("grupo_constructor_nag_mantenimiento_morelos");
  });

  it("marca nueva vertical CAPUFE nacional como posible con score penalizado", () => {
    const proc = makeProcurement({
      dependencyName: "CAPUFE",
      state: "NACIONAL",
      canonicalText:
        "capufe suministro de lubricantes y aceites para parque vehicular nacional",
    });
    const radar = getRadarByKey("hm_highmil_lubricantes_morelos");
    expect(radar).toBeDefined();
    const result = evaluateProcurementAgainstRadar(proc, radar!, true);
    expect(result).not.toBeNull();
    expect(result!.commercialTerritoryMatched).toBe("Nacional / posible");
    expect(result!.matchScore).toBeLessThan(0.75);
  });

  it("conserva excepcion CAPUFE nacional por licitacion desierta", () => {
    const proc = makeProcurement({
      dependencyName: "CAPUFE",
      status: "desierta",
      state: "NACIONAL",
      canonicalText:
        "capufe caminos y puentes federales licitacion desierta sin participantes",
    });
    const radar = getRadarByKey("capufe_oportunidades");
    expect(radar).toBeDefined();
    const result = evaluateProcurementAgainstRadar(proc, radar!, true);
    expect(result).not.toBeNull();
  });
});

describe("CAPUFE direct awards priority radar", () => {
  function makeCapufeDirectAwardCase(title: string, overrides: Partial<NormalizedProcurement> = {}) {
    return makeProcurement({
      source: "comprasmx",
      title,
      description: null,
      dependencyName: null,
      buyingUnit: null,
      state: null,
      municipality: null,
      procedureType: "unknown",
      canonicalText: title,
      rawJson: {},
      ...overrides,
    });
  }

  function evaluateCapufeDirectAwardCase(
    title: string,
    overrides: Partial<NormalizedProcurement> = {},
  ) {
    const radar = getRadarByKey("capufe_direct_awards");
    expect(radar).toBeDefined();
    return evaluateProcurementAgainstRadar(
      makeCapufeDirectAwardCase(title, overrides),
      radar!,
      true,
    );
  }

  it.each([
    "CAPUFE adjudicación directa para mantenimiento de plaza de cobro",
    "Caminos y Puentes Federales de Ingresos y Servicios Conexos — adjudicación directa de servicio",
    "Contratación por adjudicación directa para caseta de cobro CAPUFE",
    "Plaza de Cobro CAPUFE — procedimiento de adjudicación directa para suministro de refacciones",
    "Caminos y Puentes Federales — excepción a licitación pública para servicio de mantenimiento",
  ])("alerta para CAPUFE + adjudicacion directa: %s", (title) => {
    const result = evaluateCapufeDirectAwardCase(title);

    expect(result).not.toBeNull();
    expect(result!.radarKey).toBe("capufe_direct_awards");
    expect(result!.matchScore).toBe(1);
    expect(result!.matchLevel).toBe("high");
    expect(result!.scoreReasons).toEqual([
      "buyer_capufe",
      "procedure_direct_award",
      "priority_capufe_direct_award",
    ]);
  });

  it.each([
    "CAPUFE licitación pública nacional para mantenimiento de casetas",
    "Adjudicación directa de material de oficina para Gobierno de Morelos",
    "Servicio directo de mantenimiento a autopista estatal",
    "Contratación directa de seguridad privada en municipio",
    "CAPUFE invitación a cuando menos tres personas",
  ])("no alerta falsos positivos: %s", (title) => {
    const result = evaluateCapufeDirectAwardCase(title);
    expect(result).toBeNull();
  });

  it("revisa campos estructurados y anexos sin depender del titulo", () => {
    const result = evaluateCapufeDirectAwardCase("Servicio integral sin keywords", {
      dependencyName: "Caminos y Puentes Federales de Ingresos y Servicios Conexos",
      buyingUnit: "Gerencia de Tramo CAPUFE",
      procedureType: "adjudicacion_directa",
      attachments: [{
        fileName: "anexo tecnico.pdf",
        fileType: "pdf",
        fileUrl: "https://example.com/anexo.pdf",
        fileHash: null,
        detectedText: "Mantenimiento de plaza de cobro y sistema de cobro",
      }],
      rawJson: {
        comprador: "CAPUFE",
        unidad_compradora: "Delegacion Regional CAPUFE",
        objeto_contratacion: "Servicio integral sin keywords comerciales",
        lugar_de_ejecucion: "Plaza de Cobro",
      },
    });

    expect(result).not.toBeNull();
    expect(result!.matchedTerms).toEqual(expect.arrayContaining([
      "CAPUFE",
      "adjudicacion_directa",
    ]));
  });

  it("acepta directa solo si aparece en campo de tipo de procedimiento", () => {
    const directInProcedureField = evaluateCapufeDirectAwardCase("CAPUFE servicio de mantenimiento", {
      rawJson: {
        tipo_procedimiento: "Directa",
      },
    });
    const directInGenericText = evaluateCapufeDirectAwardCase(
      "CAPUFE servicio directo de mantenimiento en plaza de cobro",
    );

    expect(directInProcedureField).not.toBeNull();
    expect(directInGenericText).toBeNull();
  });

  it("no usa noticias OSINT ni fuentes externas", () => {
    const result = evaluateCapufeDirectAwardCase(
      "CAPUFE adjudicación directa para mantenimiento de plaza de cobro",
      { source: "external_osint" },
    );

    expect(result).toBeNull();
  });
});

describe("IMSS Morelos priority radar", () => {
  function makeImssCase(title: string, overrides: Partial<NormalizedProcurement> = {}) {
    return makeProcurement({
      source: "comprasmx",
      title,
      description: null,
      dependencyName: null,
      buyingUnit: null,
      state: null,
      municipality: null,
      canonicalText: title,
      rawJson: {},
      ...overrides,
    });
  }

  function evaluateImssCase(title: string, overrides: Partial<NormalizedProcurement> = {}) {
    const radar = getRadarByKey("imss_morelos");
    expect(radar).toBeDefined();
    return evaluateProcurementAgainstRadar(makeImssCase(title, overrides), radar!, true);
  }

  it.each([
    "Adquisición de material de curación para el Instituto Mexicano del Seguro Social en Morelos",
    "Servicio de mantenimiento para OOAD Morelos del IMSS",
    "Contratación de limpieza para unidades médicas del IMSS en Cuernavaca",
    "Instituto Mexicano del Seguro Social — Delegación Morelos — adquisición de papelería",
    "Unidad de Medicina Familiar del IMSS en Jiutepec solicita servicio de fumigación",
    "Instituto Mexicano del Seguro Social OOAD Morelos adquisición de material de curación",
    "IMSS Delegación Morelos contratación de servicio de mantenimiento",
    "Unidad de Medicina Familiar del IMSS en Cuernavaca adquisición de papelería",
  ])("alerta para IMSS ordinario en Morelos: %s", (title) => {
    const result = evaluateImssCase(title);

    expect(result).not.toBeNull();
    expect(result!.radarKey).toBe("imss_morelos");
    expect(result!.matchScore).toBe(1);
    expect(result!.matchLevel).toBe("high");
    expect(result!.scoreReasons).toEqual([
      "buyer_imss",
      "territory_morelos",
      "priority_institutional_radar",
    ]);
  });

  it.each([
    "IMSS Jalisco adquisición de medicamentos",
    "Gobierno de Morelos adquisición de equipo de cómputo",
    "Servicio de seguridad social para trabajadores del municipio de Cuernavaca",
    "Instituto Mexicano del Seguro Social en Estado de México adquisición de material",
    "IMSS-Bienestar Morelos adquisición de medicamentos",
    "Servicios de Salud IMSS-Bienestar en Morelos contratación de limpieza",
    "OPD IMSS-Bienestar Morelos mantenimiento de unidades médicas",
    "Organismo Público Descentralizado IMSS-Bienestar en Cuernavaca solicita insumos",
  ])("no alerta para falsos positivos o IMSS-Bienestar: %s", (title) => {
    const result = evaluateImssCase(title);
    expect(result).toBeNull();
  });

  it("revisa campos extraidos y anexos sin depender del titulo", () => {
    const result = evaluateImssCase("Servicio integral sin tema comercial", {
      dependencyName: "Instituto Mexicano del Seguro Social",
      buyingUnit: "OOAD Morelos",
      state: "Morelos",
      attachments: [{
        fileName: "anexo tecnico.pdf",
        fileType: "pdf",
        fileUrl: "https://example.com/anexo.pdf",
        fileHash: null,
        detectedText: "Unidad de Medicina Familiar del IMSS en Cuernavaca",
      }],
      rawJson: {
        comprador: "IMSS",
        lugar_de_ejecucion: "Cuernavaca, Morelos",
        objeto_contratacion: "Servicio integral sin keywords comerciales",
      },
    });

    expect(result).not.toBeNull();
    expect(result!.territoryMatched).toBe("Morelos");
  });

  it("tiene prioridad mayor que un radar comercial normal", () => {
    const proc = makeImssCase(
      "IMSS Morelos adquisición de lubricantes y aceites para parque vehicular",
      {
        dependencyName: "IMSS",
        state: "Morelos",
      },
    );
    const imssRadar = getRadarByKey("imss_morelos");
    const commercialRadar = getRadarByKey("hm_highmil_lubricantes_morelos");
    expect(imssRadar).toBeDefined();
    expect(commercialRadar).toBeDefined();

    const imssResult = evaluateProcurementAgainstRadar(proc, imssRadar!, true);
    const commercialResult = evaluateProcurementAgainstRadar(proc, commercialRadar!, true);

    expect(imssResult).not.toBeNull();
    expect(imssResult!.matchScore).toBe(1);
    expect(imssResult!.matchLevel).toBe("high");
    if (commercialResult) {
      expect(imssResult!.matchScore).toBeGreaterThan(commercialResult.matchScore);
    }
    expect(imssRadar!.priority).toBeLessThanOrEqual(commercialRadar!.priority);
  });
});
