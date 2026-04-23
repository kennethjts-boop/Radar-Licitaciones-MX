import {
  evaluateProcurementAgainstRadar,
  evaluateAllRadars,
} from "../matcher";
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
    fetchedAt: "2026-01-01T00:00:00.000Z",
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
