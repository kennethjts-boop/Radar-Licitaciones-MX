import { getActiveRadars } from "../radars";
import { evaluateAllRadars } from "../matchers/matcher";
import { normalize } from "../normalizers/procurement.normalizer";

const samples = [
  { numero: "DRY-CAPUFE", siglas: "CAPUFE", state: "JALISCO", unit: "009J0U001" },
  { numero: "DRY-IMSS-MOR", siglas: "IMSS", state: "MORELOS", unit: "050GYR007" },
  { numero: "DRY-OAX", siglas: "IMSS", state: "MORELOS", unit: "050GYR085 - CENTRO VACACIONAL IMSS OAXTEPEC" },
  { numero: "DRY-MOR", siglas: "ISSSTE", state: "MORELOS", unit: "Delegación estatal" },
  { numero: "DRY-NO", siglas: "CFE", state: "PUEBLA", unit: "División centro" },
];

const radars = getActiveRadars();
console.log(JSON.stringify({ activeFocusKeys: radars.map((radar) => radar.key) }, null, 2));
for (const sample of samples) {
  const procurement = normalize({
    source: "comprasmx",
    sourceUrl: `https://example.invalid/detalle/${sample.numero}/procedimiento`,
    externalId: sample.numero,
    procedureNumber: sample.numero,
    title: "Fixture dry-run sin acceso de red",
    dependencyName: sample.siglas,
    buyingUnit: sample.unit,
    state: sample.state,
    rawJson: {
      siglas: sample.siglas,
      unidad_compradora: sample.unit,
      entidad_federativa_contratacion: sample.state,
    },
  });
  const matches = evaluateAllRadars(procurement, radars, true);
  console.log(JSON.stringify({
    procedure: sample.numero,
    matches: matches.map((match) => match.radarKey),
    telegramAlertsExpected: matches.length > 0 ? 1 : 0,
  }));
}
