/**
 * Radares comerciales.
 *
 * Los nombres de empresas son etiquetas internas. El matching real se hace con
 * perfiles comerciales centralizados y no exige que el nombre de la empresa
 * aparezca en la licitacion.
 */
import {
  COMMERCIAL_PROFILES,
  commercialTerritoryAliases,
  type CommercialProfile,
  type CommercialProfileId,
} from "../modules/commercial-profiles";
import type { RadarConfig } from "../types/procurement";

export const LUBRICANTES_KEYWORDS = [
  ...COMMERCIAL_PROFILES.find((profile) => profile.id === "hm_highmil_lubricants")!.primaryKeywords,
  ...COMMERCIAL_PROFILES.find((profile) => profile.id === "hm_highmil_lubricants")!.secondaryKeywords,
];

export const IMPRESOS_KEYWORDS = [
  ...COMMERCIAL_PROFILES.find((profile) => profile.id === "primasa_printing")!.primaryKeywords,
  ...COMMERCIAL_PROFILES.find((profile) => profile.id === "primasa_printing")!.secondaryKeywords,
];

export const COFORMEX_IMPRESOS_ADICIONALES: string[] = [];

export const SEGURIDAD_RIESGO_KEYWORDS = [
  ...COMMERCIAL_PROFILES.find((profile) => profile.id === "uniforce_security_risk")!.primaryKeywords,
  ...COMMERCIAL_PROFILES.find((profile) => profile.id === "uniforce_security_risk")!.secondaryKeywords,
];

export const CONSTRUCCION_MANTENIMIENTO_KEYWORDS = [
  ...COMMERCIAL_PROFILES.find((profile) => profile.id === "grupo_constructor_nag_construction")!.primaryKeywords,
  ...COMMERCIAL_PROFILES.find((profile) => profile.id === "grupo_constructor_nag_construction")!.secondaryKeywords,
];

const PROFILE_RADAR_KEYS: Record<CommercialProfileId, string> = {
  hm_highmil_lubricants: "hm_highmil_lubricantes_morelos",
  primasa_printing: "primasa_impresos_morelos",
  coformex_printing: "coformex_impresos_morelos",
  uniforce_security_risk: "uniforce_seguridad_riesgo_morelos",
  grupo_constructor_nag_construction: "grupo_constructor_nag_mantenimiento_morelos",
};

function makeCommercialRadar(profile: CommercialProfile): RadarConfig {
  const includeTerms = [
    ...profile.primaryKeywords,
    ...profile.secondaryKeywords,
    ...profile.strongContextKeywords,
  ];
  const geoTerms = commercialTerritoryAliases(profile.territories);

  return {
    key: PROFILE_RADAR_KEYS[profile.id],
    name: profile.displayName,
    description:
      `Radar comercial interno para ${profile.companyName}. Detecta ${profile.businessLines.join(", ")} en territorios objetivo sin usar el nombre de la empresa como keyword.`,
    isActive: true,
    priority: 2,
    scheduleMinutes: 30,
    minScore: profile.minScore / 100,
    includeTerms,
    excludeTerms: profile.negativeKeywords,
    geoTerms,
    entityTerms: profile.preferredBuyerTypes,
    commercialProfileId: profile.id,
    rules: [
      {
        ruleType: "keyword",
        fieldName: "canonical_text",
        operator: "any_of",
        value: includeTerms,
        weight: 0.5,
        isRequired: false,
      },
      {
        ruleType: "geo",
        fieldName: "canonical_text",
        operator: "any_of",
        value: geoTerms,
        weight: 0.3,
        isRequired: false,
      },
      {
        ruleType: "keyword",
        fieldName: "canonical_text",
        operator: "none_of",
        value: profile.negativeKeywords,
        weight: 0.2,
        isRequired: false,
      },
    ],
  };
}

export const hmHighmilLubricantesRadar = makeCommercialRadar(
  COMMERCIAL_PROFILES.find((profile) => profile.id === "hm_highmil_lubricants")!,
);
export const primasaImpresosRadar = makeCommercialRadar(
  COMMERCIAL_PROFILES.find((profile) => profile.id === "primasa_printing")!,
);
export const coformexImpresosRadar = makeCommercialRadar(
  COMMERCIAL_PROFILES.find((profile) => profile.id === "coformex_printing")!,
);
export const uniforceSeguridadRiesgoRadar = makeCommercialRadar(
  COMMERCIAL_PROFILES.find((profile) => profile.id === "uniforce_security_risk")!,
);
export const grupoConstructorNagRadar = makeCommercialRadar(
  COMMERCIAL_PROFILES.find((profile) => profile.id === "grupo_constructor_nag_construction")!,
);

export const BUSINESS_LINE_RADARS: RadarConfig[] = [
  hmHighmilLubricantesRadar,
  primasaImpresosRadar,
  coformexImpresosRadar,
  uniforceSeguridadRiesgoRadar,
  grupoConstructorNagRadar,
];
