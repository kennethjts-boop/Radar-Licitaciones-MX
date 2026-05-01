import { computarModalidad, inferTipoContratacion } from "../topes.service";
import type { TipoContratacion } from "../topes.types";
import type { NormalizedProcurement } from "../../types/procurement";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTopeParams(
  tipo: TipoContratacion = "adquisicion",
  topeAd = 300_000,
  topeI3p = 2_000_000,
) {
  return { tipo, topeAdjudicacion: topeAd, topeInvitacion: topeI3p };
}

function makeProcurement(
  overrides: Partial<NormalizedProcurement> = {},
): NormalizedProcurement {
  return {
    source: "comprasmx",
    sourceUrl: "https://example.com",
    externalId: "EXT-001",
    expedienteId: null,
    licitationNumber: null,
    procedureNumber: null,
    title: "Adquisición de equipo",
    description: null,
    dependencyName: null,
    buyingUnit: null,
    procedureType: "unknown",
    status: "publicada",
    publicationDate: null,
    openingDate: null,
    awardDate: null,
    state: null,
    municipality: null,
    amount: null,
    currency: null,
    attachments: [],
    canonicalText: "adquisicion de equipo de computo",
    canonicalFingerprint: "abc123",
    lightweightFingerprint: null,
    rawJson: {},
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── computarModalidad ─────────────────────────────────────────────────────────

describe("computarModalidad", () => {
  const topes = makeTopeParams("adquisicion", 300_000, 2_000_000);

  it("devuelve adjudicacion_directa cuando monto < tope AD", () => {
    const result = computarModalidad(299_000, false, topes);
    expect(result.modalidad).toBe("adjudicacion_directa");
    expect(result.montoSinIva).toBe(299_000);
  });

  it("devuelve adjudicacion_directa cuando monto == tope AD exacto", () => {
    const result = computarModalidad(300_000, false, topes);
    expect(result.modalidad).toBe("adjudicacion_directa");
  });

  it("devuelve invitacion_tres_personas cuando monto > tope AD y <= tope I3P", () => {
    const result = computarModalidad(1_500_000, false, topes);
    expect(result.modalidad).toBe("invitacion_tres_personas");
  });

  it("devuelve licitacion_publica cuando monto > tope I3P", () => {
    const result = computarModalidad(5_000_000, false, topes);
    expect(result.modalidad).toBe("licitacion_publica");
  });

  it("divide entre 1.16 cuando incluyeIva=true", () => {
    // 348_000 / 1.16 ≈ 300_000 → adjudicacion_directa
    const result = computarModalidad(348_000, true, topes);
    expect(result.montoSinIva).toBeCloseTo(300_000, 0);
    expect(result.modalidad).toBe("adjudicacion_directa");
  });

  it("incluye topes correctos en el resultado", () => {
    const result = computarModalidad(100_000, false, topes);
    expect(result.topeAdjudicacion).toBe(300_000);
    expect(result.topeInvitacion).toBe(2_000_000);
  });

  it("analisis menciona la modalidad en español", () => {
    const result = computarModalidad(1_000_000, false, topes);
    expect(result.analisis).toContain("invitación");
    expect(result.analisis.length).toBeGreaterThan(20);
  });

  it("analisis para adjudicacion menciona el tope", () => {
    const result = computarModalidad(100_000, false, topes);
    expect(result.analisis).toContain("adjudicación");
  });

  it("analisis para licitacion_publica menciona invitación", () => {
    const result = computarModalidad(10_000_000, false, topes);
    expect(result.analisis).toContain("licitación");
  });
});

// ── inferTipoContratacion ─────────────────────────────────────────────────────

describe("inferTipoContratacion", () => {
  it("devuelve obra_publica para texto con 'obra publica'", () => {
    const p = makeProcurement({ canonicalText: "obra publica carretera morelos" });
    expect(inferTipoContratacion(p)).toBe("obra_publica");
  });

  it("devuelve obra_publica para 'construccion'", () => {
    const p = makeProcurement({ canonicalText: "construccion de puente federal" });
    expect(inferTipoContratacion(p)).toBe("obra_publica");
  });

  it("devuelve obra_publica para 'rehabilitacion'", () => {
    const p = makeProcurement({
      canonicalText: "rehabilitacion de infraestructura hidraulica",
    });
    expect(inferTipoContratacion(p)).toBe("obra_publica");
  });

  it("devuelve adquisicion por defecto", () => {
    const p = makeProcurement({ canonicalText: "compra de mobiliario de oficina" });
    expect(inferTipoContratacion(p)).toBe("adquisicion");
  });

  it("devuelve arrendamiento cuando el texto contiene 'arrendamiento'", () => {
    const p = makeProcurement({
      canonicalText: "arrendamiento de equipos de computo para oficinas",
    });
    expect(inferTipoContratacion(p)).toBe("arrendamiento");
  });

  it("arrendamiento tiene precedencia sobre obra en texto mixto", () => {
    const p = makeProcurement({
      canonicalText: "arrendamiento de maquinaria para construccion",
    });
    expect(inferTipoContratacion(p)).toBe("arrendamiento");
  });
});
