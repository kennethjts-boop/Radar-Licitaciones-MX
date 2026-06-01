import { formatMatchAlert } from "../alerts/telegram.alerts";
import { evaluateProcurementAgainstRadar } from "../matchers/matcher";
import { getRadarByKey } from "../radars";
import { detectCapufeDirectAward } from "../radars/capufe-direct-awards.matcher";
import type { EnrichedAlert, NormalizedProcurement } from "../types/procurement";

function makeProcurement(
  title: string,
  overrides: Partial<NormalizedProcurement> = {},
): NormalizedProcurement {
  return {
    source: "comprasmx",
    externalId: `DRY-${title.slice(0, 20)}`,
    expedienteId: "EXP-DRY-RUN",
    licitationNumber: null,
    procedureNumber: "PROC-DRY-RUN",
    title,
    description: null,
    dependencyName: null,
    buyingUnit: null,
    procedureType: "unknown",
    status: "activa",
    publicationDate: "2026-06-01",
    openingDate: "2026-06-30",
    awardDate: null,
    state: null,
    municipality: null,
    amount: null,
    currency: "MXN",
    attachments: [],
    canonicalText: title,
    canonicalFingerprint: "dry-run",
    lightweightFingerprint: null,
    canonicalHash: null,
    rawJson: {},
    fetchedAt: new Date().toISOString(),
    sourceUrl: "https://comprasmx.buengobierno.gob.mx/sitiopublico/#/detalle/dry-run",
    ...overrides,
  };
}

const samples = [
  {
    shouldAlert: true,
    procurement: makeProcurement("CAPUFE adjudicación directa para mantenimiento de plaza de cobro"),
  },
  {
    shouldAlert: true,
    procurement: makeProcurement(
      "Caminos y Puentes Federales de Ingresos y Servicios Conexos — adjudicación directa de servicio",
    ),
  },
  {
    shouldAlert: true,
    procurement: makeProcurement("Contratación por adjudicación directa para caseta de cobro CAPUFE"),
  },
  {
    shouldAlert: true,
    procurement: makeProcurement(
      "Plaza de Cobro CAPUFE — procedimiento de adjudicación directa para suministro de refacciones",
    ),
  },
  {
    shouldAlert: true,
    procurement: makeProcurement(
      "Caminos y Puentes Federales — excepción a licitación pública para servicio de mantenimiento",
    ),
  },
  {
    shouldAlert: false,
    procurement: makeProcurement("CAPUFE licitación pública nacional para mantenimiento de casetas"),
  },
  {
    shouldAlert: false,
    procurement: makeProcurement("Adjudicación directa de material de oficina para Gobierno de Morelos"),
  },
  {
    shouldAlert: false,
    procurement: makeProcurement("Servicio directo de mantenimiento a autopista estatal"),
  },
  {
    shouldAlert: false,
    procurement: makeProcurement("Contratación directa de seguridad privada en municipio"),
  },
  {
    shouldAlert: false,
    procurement: makeProcurement("CAPUFE invitación a cuando menos tres personas"),
  },
];

function buildAlert(procurement: NormalizedProcurement, match: NonNullable<ReturnType<typeof evaluateProcurementAgainstRadar>>): EnrichedAlert {
  return {
    alertType: "new_match",
    radarKey: match.radarKey,
    radarName: "CAPUFE — Adjudicación Directa",
    matchLevel: match.matchLevel,
    matchScore: match.matchScore,
    opportunityScore: match.opportunityScore,
    documentScore: match.documentScore,
    procurement,
    matchedTerms: match.matchedTerms,
    explanation: match.explanation,
    scoreReasons: match.scoreReasons,
    hasHistory: false,
    historyCount: 0,
    detectedAt: new Date().toISOString(),
    telegramMessage: "",
  };
}

function main(): void {
  const radar = getRadarByKey("capufe_direct_awards");
  if (!radar) {
    throw new Error("Radar capufe_direct_awards no registrado");
  }

  const reviewed = samples.filter(({ procurement }) => {
    const detection = detectCapufeDirectAward(procurement);
    return detection?.capufeTerms.length || procurement.title.toLowerCase().includes("capufe");
  });
  const matches = samples
    .map(({ procurement, shouldAlert }) => ({
      procurement,
      shouldAlert,
      match: evaluateProcurementAgainstRadar(procurement, radar, true),
    }));
  const alertable = matches.filter((item) => item.match);
  const discarded = matches.filter((item) => !item.match);

  console.log("CAPUFE Adjudicacion Directa — Dry Run");
  console.log("=====================================");
  console.log(`CAPUFE revisados: ${reviewed.length}`);
  console.log(`CAPUFE adjudicacion directa matches: ${alertable.length}`);
  console.log(`Alertas que habria enviado: ${alertable.length}`);
  console.log("");
  console.log("Ejemplos de matches:");
  for (const item of alertable.slice(0, 5)) {
    console.log(`- ${item.procurement.title}`);
  }
  console.log("");
  console.log("Ejemplos de descartes:");
  for (const item of discarded.slice(0, 5)) {
    console.log(`- ${item.procurement.title}`);
  }
  console.log("");
  console.log("Alertas que habria enviado:");
  for (const item of alertable.slice(0, 3)) {
    if (!item.match) continue;
    const alert = buildAlert(item.procurement, item.match);
    console.log("---");
    console.log(formatMatchAlert(alert).split("\n").slice(0, 8).join("\n"));
  }

  const unexpected = matches.filter((item) => Boolean(item.match) !== item.shouldAlert);
  if (unexpected.length > 0) {
    console.error("");
    console.error(`Casos inesperados: ${unexpected.length}`);
    process.exitCode = 1;
  }
}

main();
