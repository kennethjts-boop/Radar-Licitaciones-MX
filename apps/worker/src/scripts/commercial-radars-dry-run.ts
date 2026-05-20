import "dotenv/config";
import { matchCommercialOpportunity } from "../modules/commercial-matching";
import {
  createCommercialMatchingTelemetry,
  recordCommercialMatchTelemetry,
} from "../modules/commercial-matching/telemetry";

const samples = [
  "Adquisición de aceites lubricantes y anticongelantes para parque vehicular del Gobierno de Jalisco",
  "Suministro de grasas y aditivos para maquinaria pesada en Guadalajara",
  "Adquisición de aceite vegetal comestible para comedor institucional",
  "Servicio de impresión de formatos, folletos y material institucional para dependencia de CDMX",
  "Servicio de impresión diagnóstica médica",
  "Contratación de servicio de vigilancia intramuros con guardias de seguridad en Toluca",
  "Servicio de seguridad informática y firewall",
  "Servicio de mantenimiento, remodelación y rehabilitación de oficinas públicas en Morelos",
  "Mantenimiento de licencias de software",
  "Licitación nacional para suministro de anticongelantes y lubricantes para flotilla institucional",
];

function main(): void {
  const telemetry = createCommercialMatchingTelemetry(samples.length);
  const matches = [];
  const discarded = [];

  for (const title of samples) {
    const input = {
      title,
      description: title,
      buyerName: "Dependencia publica",
      dependency: "Dependencia publica",
      unit: "Adquisiciones",
      source: "commercial-radars-dry-run",
      sourceUrl: "https://example.gob.mx/oportunidad",
      publicationDate: new Date().toISOString(),
      fullText: title,
    };
    const result = matchCommercialOpportunity(input);
    recordCommercialMatchTelemetry(telemetry, input, result);
    if (result.shouldAlert) matches.push({ title, result });
    else discarded.push({ title, result });
  }

  const averageScore =
    matches.length > 0
      ? Math.round(matches.reduce((sum, item) => sum + item.result.score, 0) / matches.length)
      : 0;

  console.log(
    [
      "Commercial Radars — Dry Run",
      "===========================",
      `Registros revisados: ${telemetry.totalReviewed}`,
      `Candidatos comerciales: ${telemetry.commercialCandidates}`,
      `Alertas que habria enviado: ${matches.length}`,
      `Score promedio matches: ${averageScore}`,
      `Matches por perfil: ${JSON.stringify(telemetry.matchesByProfile)}`,
      `Matches por territorio: ${JSON.stringify(telemetry.matchesByTerritory)}`,
      `Descartes no territorio: ${telemetry.discardedByNoTerritory}`,
      `Descartes keyword: ${telemetry.discardedByKeyword}`,
      `Descartes negative keyword: ${telemetry.discardedByNegativeKeyword}`,
      `Descartes bajo score: ${telemetry.discardedByLowScore}`,
      "",
      "Top oportunidades:",
      ...telemetry.topMatchedCandidates.map(
        (item) => `- ${item.profile} | ${item.territory ?? "N/D"} | ${item.score} | ${item.title}`,
      ),
      "",
      "Top descartes:",
      ...telemetry.topDiscardedCandidates.map(
        (item) => `- ${item.profile ?? "N/D"} | ${item.reason ?? "N/D"} | ${item.score} | ${item.title}`,
      ),
    ].join("\n"),
  );
}

main();
