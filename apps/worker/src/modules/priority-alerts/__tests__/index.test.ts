import { detectPriorityAlertProfile } from "../index";
import type { NormalizedProcurement } from "../../../types/procurement";

function makeProcurement(overrides: Partial<NormalizedProcurement> = {}): NormalizedProcurement {
  return {
    source: "comprasmx",
    sourceUrl: "https://comprasmx.example/proc/1",
    externalId: "proc-1",
    expedienteId: "E-1",
    licitationNumber: "LA-09-J0U-009J0U012-N-7-2026",
    procedureNumber: "LA-09-J0U-009J0U012-N-7-2026",
    title: "Servicio genérico",
    description: null,
    dependencyName: null,
    buyingUnit: null,
    procedureType: "licitacion_publica",
    status: "activa",
    publicationDate: null,
    openingDate: null,
    awardDate: null,
    state: null,
    municipality: null,
    amount: null,
    currency: "MXN",
    attachments: [],
    canonicalText: "",
    canonicalFingerprint: "fingerprint",
    lightweightFingerprint: null,
    canonicalHash: null,
    rawJson: {},
    fetchedAt: "2026-06-29T00:00:00Z",
    ...overrides,
  };
}

describe("detectPriorityAlertProfile", () => {
  it("detecta CAPUFE/FONADIN por peaje, telepeaje, México-Cuernavaca y FONADIN", () => {
    const profile = detectPriorityAlertProfile(makeProcurement({
      title:
        "Mantenimiento correctivo y preventivo a sistemas de peaje, telepeaje y control de tránsito: Tramos México-Cuernavaca, Michapa-Puebla y Red Concesionada FONADIN.",
    }));

    expect(profile?.label).toBe("Mantenimiento Peaje/Telepeaje CAPUFE-FONADIN");
  });

  it("detecta CAPUFE/FONADIN por CAPUFE y plazas de cobro", () => {
    const profile = detectPriorityAlertProfile(makeProcurement({
      title: "Servicio de mantenimiento para plazas de cobro",
      dependencyName: "Caminos y Puentes Federales CAPUFE",
    }));

    expect(profile?.id).toBe("capufe_fonadin_peaje_telepeaje");
  });

  it("detecta IMSS/ISSSTE Morelos por Servicio Médico Integral de Laboratorio Clínico", () => {
    const profile = detectPriorityAlertProfile(makeProcurement({
      title:
        "Contratación del Servicio Médico Integral de Laboratorio Clínico y de Análisis Clínicos para las Unidades Médicas del IMSS e ISSSTE en el Estado de Morelos.",
    }));

    expect(profile?.label).toBe("Laboratorios IMSS/ISSSTE Morelos");
  });

  it("detecta IMSS/ISSSTE Morelos por reactivos, material de laboratorio, IMSS y Morelos", () => {
    const profile = detectPriorityAlertProfile(makeProcurement({
      title: "Adquisición de reactivos y material de laboratorio",
      dependencyName: "IMSS",
      state: "Morelos",
    }));

    expect(profile?.id).toBe("imss_issste_morelos_laboratorios");
  });
});
