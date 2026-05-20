import { findMatchingTerms, normalizeText } from "../../core/text";

export type CommercialTerritoryId =
  | "morelos"
  | "jalisco_guadalajara"
  | "cdmx"
  | "edomex";

export interface CommercialTerritory {
  id: CommercialTerritoryId;
  displayName: string;
  aliases: string[];
  stateAliases: string[];
}

export interface TerritoryMatchResult {
  matched: boolean;
  territoryMatched: string | null;
  territoryId: CommercialTerritoryId | "nacional_posible" | null;
  matchedTerms: string[];
  isNationalPossible: boolean;
}

export const COMMERCIAL_TERRITORIES: CommercialTerritory[] = [
  {
    id: "morelos",
    displayName: "Morelos",
    aliases: [
      "Morelos",
      "Cuernavaca",
      "Jiutepec",
      "Temixco",
      "Cuautla",
      "Jojutla",
      "Zacatepec",
      "Tlaltizapan",
      "Tlaltizapán",
      "Yautepec",
      "Emiliano Zapata",
      "Xochitepec",
      "Puente de Ixtla",
      "Tlaquiltenango",
      "Huitzilac",
      "Yecapixtla",
    ],
    stateAliases: ["morelos", "estado de morelos"],
  },
  {
    id: "jalisco_guadalajara",
    displayName: "Guadalajara / Jalisco",
    aliases: [
      "Jalisco",
      "Guadalajara",
      "Zapopan",
      "San Pedro Tlaquepaque",
      "Tlaquepaque",
      "Tonala",
      "Tonalá",
      "Tlajomulco",
      "Tlajomulco de Zuniga",
      "Tlajomulco de Zúñiga",
      "Puerto Vallarta",
      "El Salto",
      "Gobierno de Jalisco",
      "Ayuntamiento de Guadalajara",
    ],
    stateAliases: ["jalisco"],
  },
  {
    id: "cdmx",
    displayName: "Ciudad de México / CDMX",
    aliases: [
      "Ciudad de Mexico",
      "Ciudad de México",
      "CDMX",
      "Gobierno de la Ciudad de Mexico",
      "Gobierno de la Ciudad de México",
      "Alcaldia",
      "Alcaldía",
      "Alcaldias",
      "Alcaldías",
      "Iztapalapa",
      "Gustavo A. Madero",
      "Cuauhtemoc",
      "Cuauhtémoc",
      "Benito Juarez",
      "Benito Juárez",
      "Miguel Hidalgo",
      "Coyoacan",
      "Coyoacán",
      "Tlalpan",
      "Alvaro Obregon",
      "Álvaro Obregón",
      "Azcapotzalco",
      "Venustiano Carranza",
      "Iztacalco",
      "Xochimilco",
      "Milpa Alta",
      "Tlahuac",
      "Tláhuac",
      "Magdalena Contreras",
      "Cuajimalpa",
    ],
    stateAliases: [
      "ciudad de mexico",
      "ciudad de méxico",
      "cdmx",
      "distrito federal",
    ],
  },
  {
    id: "edomex",
    displayName: "Estado de México / Edomex",
    aliases: [
      "Estado de Mexico",
      "Estado de México",
      "Edomex",
      "Toluca",
      "Ecatepec",
      "Naucalpan",
      "Tlalnepantla",
      "Nezahualcoyotl",
      "Nezahualcóyotl",
      "Metepec",
      "Atizapan",
      "Atizapán",
      "Atizapan de Zaragoza",
      "Atizapán de Zaragoza",
      "Cuautitlan",
      "Cuautitlán",
      "Cuautitlan Izcalli",
      "Cuautitlán Izcalli",
      "Texcoco",
      "Chimalhuacan",
      "Chimalhuacán",
      "Chalco",
      "Ixtapaluca",
      "Nicolas Romero",
      "Nicolás Romero",
      "Huixquilucan",
      "Lerma",
      "Zinacantepec",
    ],
    stateAliases: [
      "estado de mexico",
      "estado de méxico",
      "edomex",
      "mexico",
      "méxico",
    ],
  },
];

const NATIONAL_TERMS = [
  "nacional",
  "cobertura nacional",
  "territorio nacional",
  "republica mexicana",
  "república mexicana",
  "varias entidades federativas",
  "entrega nacional",
];

function commercialTerritoryById(id: CommercialTerritoryId): CommercialTerritory {
  const territory = COMMERCIAL_TERRITORIES.find((item) => item.id === id);
  if (!territory) throw new Error(`Commercial territory not found: ${id}`);
  return territory;
}

export function commercialTerritoryAliases(ids?: CommercialTerritoryId[]): string[] {
  const territories = ids?.length
    ? ids.map(commercialTerritoryById)
    : COMMERCIAL_TERRITORIES;
  return [...new Set(territories.flatMap((territory) => territory.aliases))];
}

export function detectCommercialTerritory(input: {
  text: string;
  state?: string | null;
  municipality?: string | null;
  placeOfExecution?: string | null;
  placeOfDelivery?: string | null;
  territories?: CommercialTerritoryId[];
}): TerritoryMatchResult {
  const targetTerritories = input.territories?.length
    ? input.territories.map(commercialTerritoryById)
    : COMMERCIAL_TERRITORIES;

  const structuredText = [
    input.state ?? "",
    input.municipality ?? "",
    input.placeOfExecution ?? "",
    input.placeOfDelivery ?? "",
  ].join(" ");
  const fullText = [structuredText, input.text].join(" ");
  const normalizedState = normalizeText(input.state ?? "");

  for (const territory of targetTerritories) {
    const structuredMatches = findMatchingTerms(structuredText, territory.aliases);
    const textAliases = territory.id === "edomex"
      ? territory.aliases.filter((alias) => normalizeText(alias) !== "mexico")
      : territory.aliases;
    const textMatches = findMatchingTerms(fullText, textAliases);
    const stateMatches = territory.stateAliases.some(
      (alias) => normalizeText(alias) === normalizedState,
    )
      ? [input.state ?? territory.displayName]
      : [];
    const matches = [...new Set([...structuredMatches, ...textMatches, ...stateMatches])];

    if (matches.length > 0) {
      return {
        matched: true,
        territoryMatched: territory.displayName,
        territoryId: territory.id,
        matchedTerms: matches,
        isNationalPossible: false,
      };
    }
  }

  const nationalMatches = findMatchingTerms(fullText, NATIONAL_TERMS);
  if (nationalMatches.length > 0) {
    return {
      matched: true,
      territoryMatched: "Nacional / posible",
      territoryId: "nacional_posible",
      matchedTerms: nationalMatches,
      isNationalPossible: true,
    };
  }

  return {
    matched: false,
    territoryMatched: null,
    territoryId: null,
    matchedTerms: [],
    isNationalPossible: false,
  };
}
