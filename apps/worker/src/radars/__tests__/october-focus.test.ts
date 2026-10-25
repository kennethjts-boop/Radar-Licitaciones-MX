import { normalize } from "../../normalizers/procurement.normalizer";
import { evaluateAllRadars } from "../../matchers/matcher";
import { getActiveRadars } from "../index";
import { OPERATIONAL_FOCUS_KEYS } from "../operational-focus.matcher";
import { evaluateNewTenderPublication } from "../../modules/operational-alerts/eligibility";

function tender(title: string, buyer: string, unit = "Unidad central", extra: Record<string, string> = {}) {
  return normalize({
    source: "comprasmx",
    sourceUrl: "https://comprasmx.example/detalle/fixture",
    externalId: "FIXTURE-2026",
    title,
    dependencyName: buyer,
    buyingUnit: unit,
    publicationDate: "14/10/2026 10:00",
    rawJson: { siglas: buyer, unidad_compradora: unit, ...extra },
  });
}

function keys(title: string, buyer: string, unit?: string, extra?: Record<string, string>): string[] {
  return evaluateAllRadars(tender(title, buyer, unit, extra), getActiveRadars(), true)
    .map((match) => match.radarKey);
}

describe("once focos de octubre", () => {
  it("mantiene exactamente once claves activas de octubre (más cuatro focos Edomex)", () => {
    const october = getActiveRadars().filter((radar) => !radar.key.startsWith("edomex_"));
    expect(october).toHaveLength(11);
    expect(new Set(october.map((radar) => radar.key)).size).toBe(11);
    expect(getActiveRadars()).toHaveLength(15);
  });

  it.each([
    ["Servicio de seguridad y vigilancia con guardias", "CAPUFE", OPERATIONAL_FOCUS_KEYS.capufeSecurity],
    ["Adquisición de ambulancias y unidades de auxilio vial", "CAPUFE", OPERATIONAL_FOCUS_KEYS.capufeEmergencyVehicles],
    ["Arrendamiento de vehículos administrativos", "CAPUFE", OPERATIONAL_FOCUS_KEYS.capufeAdministrativeVehicles],
    ["Servicio integral de limpieza general en oficinas", "CAPUFE", OPERATIONAL_FOCUS_KEYS.capufeGeneralCleaning],
    ["Adquisición de mobiliario y equipamiento de oficinas", "CAPUFE", OPERATIONAL_FOCUS_KEYS.capufeFurniture],
    ["Servicio especial de limpieza con cobertura nacional", "CAPUFE", OPERATIONAL_FOCUS_KEYS.capufeSpecialNationalCleaning],
    ["Servicio integral de limpieza hospitalaria", "IMSS", OPERATIONAL_FOCUS_KEYS.imssCleaning],
    ["Servicio de vigilancia con guardias en inmuebles", "IMSS", OPERATIONAL_FOCUS_KEYS.imssSecurity],
    ["Servicio médico integral de estudios de laboratorio clínico", "IMSS", OPERATIONAL_FOCUS_KEYS.imssClinicalLaboratory],
    ["Servicio médico integral de banco de sangre", "IMSS", OPERATIONAL_FOCUS_KEYS.imssBloodBank],
  ])("%s coincide sólo con el foco requerido", (title, buyer, expected) => {
    expect(keys(title, buyer)).toEqual([expected]);
  });

  it("detecta flota administrativa sin la etiqueta literal vehículos administrativos", () => {
    expect(keys("Arrendamiento de flota vehicular nueva para oficinas", "CAPUFE"))
      .toEqual([OPERATIONAL_FOCUS_KEYS.capufeAdministrativeVehicles]);
    expect(keys("Adquisición de llantas para la flota vehicular", "CAPUFE")).toEqual([]);
  });

  it("detecta limpieza nacional aunque no diga especial", () => {
    expect(keys("Servicio integral de limpieza para la red nacional", "CAPUFE"))
      .toEqual([OPERATIONAL_FOCUS_KEYS.capufeSpecialNationalCleaning]);
    expect(keys("Servicio integral de limpieza de oficinas regionales", "CAPUFE"))
      .toEqual([OPERATIONAL_FOCUS_KEYS.capufeGeneralCleaning]);
  });

  it.each([
    ["Servicio de vigilancia presencial", "Caminos y Puentes Federales de Ingresos y Servicios Conexos", OPERATIONAL_FOCUS_KEYS.capufeSecurity],
    ["Compra de grúas de arrastre", "CAPUFE", OPERATIONAL_FOCUS_KEYS.capufeEmergencyVehicles],
    ["Adquisición de escritorios y archiveros", "CAPUFE", OPERATIONAL_FOCUS_KEYS.capufeFurniture],
    ["Servicio de limpieza profunda en toda la red", "CAPUFE", OPERATIONAL_FOCUS_KEYS.capufeSpecialNationalCleaning],
    ["Prestación de servicios de análisis clínicos", "Instituto Mexicano del Seguro Social", OPERATIONAL_FOCUS_KEYS.imssClinicalLaboratory],
    ["Contratación de servicio de medicina transfusional", "IMSS", OPERATIONAL_FOCUS_KEYS.imssBloodBank],
  ])("acepta variante semántica: %s", (title, buyer, expected) => {
    expect(keys(title, buyer)).toEqual([expected]);
  });

  it("Oaxtepec coincide con cualquier objeto, incluso sin mención geográfica", () => {
    expect(keys("Suministro de alimentos", "IMSS", "050GYR085 Centro Vacacional"))
      .toEqual([OPERATIONAL_FOCUS_KEYS.imssOaxtepec]);
  });

  it.each([
    ["Servicio de videovigilancia CCTV", "CAPUFE"],
    ["Adquisición de cámaras para vigilancia electrónica", "IMSS"],
    ["Compra de materiales de limpieza", "IMSS"],
    ["Servicio de suministro de insumos de limpieza general", "CAPUFE"],
    ["Mantenimiento y refacciones de ambulancias", "CAPUFE"],
    ["Mantenimiento de mobiliario y refacciones de sillas", "CAPUFE"],
    ["Servicio especial de limpieza en la delegación Morelos", "CAPUFE"],
    ["Servicio especial de limpieza en Morelos", "CAPUFE"],
    ["Adquisición de reactivos para laboratorio clínico", "IMSS"],
    ["Compra de bolsas para banco de sangre", "IMSS"],
  ])("descarta falso positivo: %s", (title, buyer) => {
    expect(keys(title, buyer)).toEqual([]);
  });

  it("no infiere cobertura de limpieza desde carácter nacional de licitación", () => {
    expect(keys("Servicio especial de limpieza en Morelos", "CAPUFE", "Delegación Morelos", {
      caracter: "Nacional",
    })).toEqual([]);
  });

  it("distingue IMSS-Bienestar y dependencia ajena", () => {
    expect(keys("Servicio integral de limpieza", "IMSS-Bienestar")).toEqual([]);
    expect(keys("Servicio integral de limpieza", "ISSSTE")).toEqual([]);
    expect(keys("Servicio de seguridad privada", "CAPUFE", "Unidad central", {
      dependencia: "IMSS",
      siglas: "IMSS",
    })).toEqual([OPERATIONAL_FOCUS_KEYS.imssSecurity]);
  });

  it("Oaxtepec requiere código de unidad compradora estructurada", () => {
    expect(keys("Compra de papel", "IMSS", "050GYR007",
      { objeto_contratacion: "Destino Oaxtepec 050GYR085" })).toEqual([]);
    expect(keys("Compra de papel", "IMSS-Bienestar", "050GYR085")).toEqual([]);
  });

  it("focos superpuestos conservan varios matches y una identidad deduplicable", () => {
    const item = tender("Servicio de limpieza integral", "IMSS", "050GYR085");
    const matches = evaluateAllRadars(item, getActiveRadars(), true);
    expect(matches.map((match) => match.radarKey)).toEqual([
      OPERATIONAL_FOCUS_KEYS.imssCleaning,
      OPERATIONAL_FOCUS_KEYS.imssOaxtepec,
    ]);
    expect(new Set(matches.map((match) => match.procurementId)).size).toBe(1);
  });

  it("el corte se aplica a cada foco usando publicación oficial", () => {
    for (const radar of getActiveRadars()) {
      expect(evaluateNewTenderPublication("2026-10-13").eligible).toBe(false);
      expect(evaluateNewTenderPublication(null).eligible).toBe(false);
      expect(evaluateNewTenderPublication("2026-10-14").eligible).toBe(true);
      expect(radar.isActive).toBe(true);
    }
  });

  it("la fecha de modificación del expediente no sustituye publicación ausente", () => {
    const item = tender("Servicio integral de limpieza", "IMSS");
    item.publicationDate = null;
    item.rawJson.fecha_modificacion = "14/10/2026 12:00";
    expect(evaluateAllRadars(item, getActiveRadars(), true).map((match) => match.radarKey))
      .toEqual([OPERATIONAL_FOCUS_KEYS.imssCleaning]);
    expect(evaluateNewTenderPublication(item.publicationDate).eligible).toBe(false);
  });
});
