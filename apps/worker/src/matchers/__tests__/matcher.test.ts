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
  it("mantiene exactamente los cuatro focos operativos activos", () => {
    const keys = getActiveRadars().map((radar) => radar.key);
    expect(keys).toEqual([
      "capufe_oportunidades",
      "imss_morelos",
      "imss_bienestar_morelos",
      "habitat_morelos",
    ]);
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

describe("CAPUFE specialized radar guard", () => {
  it("no activa CAPUFE mantenimiento por términos genéricos en licitación IMSS Guerrero electromédica", () => {
    const radar = getRadarByKey("capufe_mantenimiento_equipos");
    expect(radar).toBeDefined();

    const result = evaluateProcurementAgainstRadar(
      makeProcurement({
        dependencyName: "IMSS",
        buyingUnit: "OOAD Guerrero",
        state: "GUERRERO",
        municipality: null,
        title: "SERVICIO DE MANTENIMIENTO PREVENTIVO Y CORRECTIVO A EQUIPOS ELECTROMÉDICOS",
        description: null,
        licitationNumber: "IA-50-GYR-050GYR001-N-65-2026",
        expedienteId: "E-2026-00069043",
        canonicalText:
          "IMSS Guerrero SERVICIO DE MANTENIMIENTO PREVENTIVO Y CORRECTIVO A EQUIPOS ELECTROMÉDICOS hospital equipo medico",
      }),
      radar!,
      true,
    );

    expect(result).toBeNull();
  });

  it("sí activa CAPUFE mantenimiento cuando hay señal fuerte de peaje/telepeaje", () => {
    const radar = getRadarByKey("capufe_mantenimiento_equipos");
    expect(radar).toBeDefined();

    const result = evaluateProcurementAgainstRadar(
      makeProcurement({
        dependencyName: "CAPUFE",
        state: "MORELOS",
        title: "Mantenimiento preventivo y correctivo a equipos de peaje y telepeaje",
        canonicalText:
          "CAPUFE mantenimiento preventivo y correctivo a equipos de peaje telepeaje plaza de cobro",
      }),
      radar!,
      true,
    );

    expect(result).not.toBeNull();
    expect(result!.radarKey).toBe("capufe_mantenimiento_equipos");
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

describe("cuatro focos operativos estructurados", () => {
  function structured(overrides: Partial<NormalizedProcurement>) {
    return makeProcurement({
      source: "comprasmx",
      title: "Texto incidental sin valor para el matcher",
      description: "Morelos puede aparecer aquí sin controlar el match",
      dependencyName: null,
      buyingUnit: null,
      state: null,
      canonicalText: "morelos texto secundario",
      rawJson: {},
      ...overrides,
    });
  }

  it("A/B: CAPUFE nacional coincide sin importar el estado", () => {
    for (const state of ["NACIONAL", "JALISCO", "MORELOS", "OAXACA"]) {
      const procurement = structured({ dependencyName: "CAPUFE", state });
      const match = evaluateProcurementAgainstRadar(
        procurement,
        getRadarByKey("capufe_oportunidades")!,
        true,
      );
      expect(match).not.toBeNull();
    }
  });

  it("C/D: IMSS Morelos coincide e IMSS de otro estado no", () => {
    const radar = getRadarByKey("imss_morelos")!;
    expect(evaluateProcurementAgainstRadar(structured({
      dependencyName: "IMSS",
      state: "MORELOS",
      rawJson: { siglas: "IMSS", entidad_federativa_contratacion: "MORELOS" },
    }), radar, true)).not.toBeNull();
    expect(evaluateProcurementAgainstRadar(structured({
      dependencyName: "IMSS",
      state: "JALISCO",
      rawJson: { siglas: "IMSS", entidad_federativa_contratacion: "JALISCO" },
    }), radar, true)).toBeNull();
  });

  it("E: IMSS Oaxtepec usa la unidad compradora histórica 050GYR085", () => {
    const match = evaluateProcurementAgainstRadar(structured({
      dependencyName: "IMSS",
      buyingUnit: "050GYR085 - CENTRO VACACIONAL IMSS OAXTEPEC",
      state: "MORELOS",
      rawJson: {
        siglas: "IMSS",
        unidad_compradora: "050GYR085 - CENTRO VACACIONAL IMSS OAXTEPEC",
        entidad_federativa_contratacion: "MORELOS",
      },
    }), getRadarByKey("imss_bienestar_morelos")!, true);
    expect(match?.territoryMatched).toBe("Oaxtepec, Morelos");
  });

  it("F/G: otra dependencia en Morelos coincide; texto incidental no", () => {
    const radar = getRadarByKey("habitat_morelos")!;
    expect(evaluateProcurementAgainstRadar(structured({
      dependencyName: "ISSSTE",
      state: "MORELOS",
    }), radar, true)).not.toBeNull();
    expect(evaluateProcurementAgainstRadar(structured({
      dependencyName: "CFE",
      state: "PUEBLA",
      title: "Documento secundario menciona Morelos",
    }), radar, true)).toBeNull();
  });

  it("H: IMSS Morelos registra dos razones de perfil para una sola identidad", () => {
    const procurement = structured({
      dependencyName: "IMSS",
      state: "MORELOS",
      rawJson: { siglas: "IMSS", entidad_federativa_contratacion: "MORELOS" },
    });
    const matches = evaluateAllRadars(procurement, getActiveRadars(), true);
    expect(matches.map((match) => match.radarKey)).toEqual([
      "imss_morelos",
      "habitat_morelos",
    ]);
    expect(new Set(matches.map((match) => match.procurementId)).size).toBe(1);
  });

  it("IMSS Oaxtepec puede registrar tres razones con una sola identidad", () => {
    const procurement = structured({
      externalId: "OAX-TRIPLE",
      dependencyName: "IMSS",
      buyingUnit: "050GYR085 - CENTRO VACACIONAL IMSS OAXTEPEC",
      state: "MORELOS",
      rawJson: {
        siglas: "IMSS",
        unidad_compradora: "050GYR085 - CENTRO VACACIONAL IMSS OAXTEPEC",
        entidad_federativa_contratacion: "MORELOS",
      },
    });
    const matches = evaluateAllRadars(procurement, getActiveRadars(), true);
    expect(matches.map((match) => match.radarKey)).toEqual([
      "imss_morelos",
      "imss_bienestar_morelos",
      "habitat_morelos",
    ]);
    expect(new Set(matches.map((match) => match.procurementId)).size).toBe(1);
  });
});
