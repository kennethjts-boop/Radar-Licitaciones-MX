import { getActiveRadars } from "../radars";
import { evaluateAllRadars } from "../matchers/matcher";
import { normalize } from "../normalizers/procurement.normalizer";

const samples = [
  { numero: "01", siglas: "CAPUFE", title: "Servicio de seguridad y vigilancia", unit: "Oficinas centrales" },
  { numero: "02", siglas: "CAPUFE", title: "Adquisición de ambulancias y unidades de auxilio vial", unit: "Oficinas centrales" },
  { numero: "03", siglas: "CAPUFE", title: "Arrendamiento de vehículos administrativos", unit: "Oficinas centrales" },
  { numero: "04", siglas: "CAPUFE", title: "Servicio integral de limpieza general", unit: "Oficinas centrales" },
  { numero: "05", siglas: "CAPUFE", title: "Adquisición de mobiliario y equipamiento", unit: "Oficinas centrales" },
  { numero: "06", siglas: "CAPUFE", title: "Servicio especial de limpieza de alcance nacional", unit: "Oficinas centrales" },
  { numero: "07", siglas: "IMSS", title: "Servicio integral de limpieza", unit: "Oficinas centrales" },
  { numero: "08", siglas: "IMSS", title: "Servicio de seguridad y vigilancia", unit: "Oficinas centrales" },
  { numero: "09", siglas: "IMSS", title: "Servicio médico integral de estudios de laboratorio clínico", unit: "Oficinas centrales" },
  { numero: "10", siglas: "IMSS", title: "Servicio médico integral de banco de sangre", unit: "Oficinas centrales" },
  { numero: "11", siglas: "IMSS", title: "Suministro de alimentos", unit: "050GYR085 - CENTRO VACACIONAL IMSS OAXTEPEC" },
];

const radars = getActiveRadars();
console.log(JSON.stringify({ activeFocusKeys: radars.map((radar) => radar.key) }, null, 2));
for (const sample of samples) {
  const procurement = normalize({
    source: "comprasmx",
    sourceUrl: `https://example.invalid/detalle/${sample.numero}/procedimiento`,
    externalId: sample.numero,
    procedureNumber: sample.numero,
    title: sample.title,
    dependencyName: sample.siglas,
    buyingUnit: sample.unit,
    state: null,
    rawJson: {
      siglas: sample.siglas,
      unidad_compradora: sample.unit,
    },
  });
  const matches = evaluateAllRadars(procurement, radars, true);
  console.log(JSON.stringify({
    procedure: sample.numero,
    matches: matches.map((match) => match.radarKey),
    telegramAlertsExpected: matches.length > 0 ? 1 : 0,
  }));
}
