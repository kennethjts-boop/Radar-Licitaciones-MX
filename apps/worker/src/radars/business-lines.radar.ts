/**
 * RADARES: nuevas lineas de negocio.
 *
 * Alcance deliberadamente restringido a Morelos para no ampliar el radar
 * nacional. Los nombres de empresas se mantienen solo como referencia interna
 * en nombre/descripcion del radar; no se usan como keywords de licitacion.
 */
import type { RadarConfig } from "../types/procurement";

const MORELOS_GEO_TERMS = [
  "morelos",
  "estado de morelos",
  "cuernavaca",
  "cuautla",
  "jiutepec",
  "temixco",
  "jojutla",
  "zacatepec",
  "yautepec",
  "puente de ixtla",
  "emiliano zapata",
  "xochitepec",
  "ayala",
  "yecapixtla",
  "tlaltizapan",
  "tlaltizapán",
  "tlaquiltenango",
];

export const LUBRICANTES_KEYWORDS = [
  "aceite",
  "aceites",
  "aceite industrial",
  "aceites industriales",
  "aceite automotriz",
  "aceite para motor",
  "aceite lubricante",
  "lubricante",
  "lubricantes",
  "lubricantes industriales",
  "aditivo",
  "aditivos",
  "aditivo automotriz",
  "aditivos automotrices",
  "grasa",
  "grasas",
  "grasa lubricante",
  "grasas lubricantes",
  "grasa industrial",
  "grasas industriales",
  "anticongelante",
  "anticongelantes",
  "refrigerante automotriz",
  "líquido refrigerante",
  "líquido anticongelante",
  "fluidos automotrices",
  "suministro de lubricantes",
  "suministro de aceites",
  "mantenimiento vehicular lubricantes",
  "flotilla lubricantes",
  "parque vehicular lubricantes",
  "lubricacion",
  "lubricación",
  "lubricante industrial",
  "grasa multiusos",
  "grasa para maquinaria",
  "aceite hidráulico",
  "aceite hidraulico",
  "aceite dieléctrico",
  "aceite dielectrico",
  "aceite de transmisión",
  "aceite transmision",
  "anticongelante automotriz",
];

export const IMPRESOS_KEYWORDS = [
  "impresos",
  "impresión",
  "impresion",
  "servicio de impresión",
  "servicio de impresion",
  "material impreso",
  "materiales impresos",
  "formatos impresos",
  "papelería impresa",
  "papeleria impresa",
  "folletos",
  "trípticos",
  "tripticos",
  "carteles",
  "lonas",
  "viniles",
  "etiquetas",
  "engomados",
  "boletos",
  "comprobantes",
  "recibos",
  "formas valoradas",
  "impresión offset",
  "impresion offset",
  "impresión digital",
  "impresion digital",
  "serigrafía",
  "serigrafia",
  "diseño e impresión",
  "diseño e impresion",
  "producción de impresos",
  "produccion de impresos",
];

export const COFORMEX_IMPRESOS_ADICIONALES = [
  "coformas",
  "formas continuas",
  "formatos administrativos",
  "documentación impresa",
  "documentacion impresa",
  "archivo impreso",
  "impresión institucional",
  "impresion institucional",
  "impresión gubernamental",
  "impresion gubernamental",
  "material gráfico",
  "material grafico",
];

export const SEGURIDAD_RIESGO_KEYWORDS = [
  "diagnóstico personal de riesgo",
  "diagnostico personal de riesgo",
  "control de confianza",
  "evaluación psicométrica",
  "evaluacion psicometrica",
  "evaluación socioeconómica",
  "evaluacion socioeconomica",
  "análisis de riesgo",
  "analisis de riesgo",
  "evaluación de autotransporte",
  "evaluacion de autotransporte",
  "evaluación de solvencia",
  "evaluacion de solvencia",
  "validación de documentos",
  "validacion de documentos",
  "seguridad intramuros",
  "guardia de seguridad",
  "guardias de seguridad",
  "seguridad privada",
  "vigilancia",
  "vigilancia intramuros",
  "vigilancia armada",
  "vigilancia desarmada",
  "guardia armado",
  "guardia desarmado",
  "servicio de seguridad",
  "servicios de seguridad",
  "protección patrimonial",
  "proteccion patrimonial",
  "análisis socioeconómico",
  "analisis socioeconomico",
  "estudio socioeconómico",
  "estudio socioeconomico",
  "pruebas psicométricas",
  "pruebas psicometricas",
  "investigación laboral",
  "investigacion laboral",
  "investigación de antecedentes",
  "investigacion de antecedentes",
  "verificación documental",
  "verificacion documental",
  "autenticidad de documentos",
  "estudio de confiabilidad",
  "evaluación de confiabilidad",
  "evaluacion de confiabilidad",
  "risk assessment",
  "background check",
];

export const CONSTRUCCION_MANTENIMIENTO_KEYWORDS = [
  "construcción",
  "construccion",
  "obra pública",
  "obra publica",
  "obras públicas",
  "obras publicas",
  "remodelación",
  "remodelacion",
  "mantenimiento",
  "mantenimiento de inmuebles",
  "mantenimiento de edificios",
  "mantenimiento a instalaciones",
  "conservación de inmuebles",
  "conservacion de inmuebles",
  "rehabilitación",
  "rehabilitacion",
  "rehabilitación de espacios",
  "rehabilitacion de espacios",
  "adecuación de espacios",
  "adecuacion de espacios",
  "reparación de inmuebles",
  "reparacion de inmuebles",
  "albañilería",
  "albañileria",
  "pintura",
  "impermeabilización",
  "impermeabilizacion",
  "herrería",
  "herreria",
  "plomería",
  "plomeria",
  "electricidad",
  "instalaciones eléctricas",
  "instalaciones electricas",
  "mantenimiento preventivo",
  "mantenimiento correctivo",
  "mantenimiento general",
  "obra civil",
  "servicios de construcción",
  "servicios de construccion",
  "contratista",
  "conservación y mantenimiento",
  "conservacion y mantenimiento",
];

function makeMorelosBusinessRadar(params: {
  key: string;
  name: string;
  description: string;
  includeTerms: string[];
  priority?: number;
  minScore?: number;
}): RadarConfig {
  return {
    key: params.key,
    name: params.name,
    description: params.description,
    isActive: true,
    priority: params.priority ?? 2,
    scheduleMinutes: 30,
    minScore: params.minScore ?? 0.45,
    includeTerms: params.includeTerms,
    excludeTerms: [],
    geoTerms: MORELOS_GEO_TERMS,
    entityTerms: [],
    rules: [
      {
        ruleType: "geo",
        fieldName: "canonical_text",
        operator: "any_of",
        value: MORELOS_GEO_TERMS,
        weight: 0.4,
        isRequired: true,
      },
      {
        ruleType: "keyword",
        fieldName: "canonical_text",
        operator: "any_of",
        value: params.includeTerms,
        weight: 0.4,
        isRequired: true,
      },
      {
        ruleType: "geo",
        fieldName: "state",
        operator: "any_of",
        value: ["morelos"],
        weight: 0.3,
        isRequired: false,
      },
    ],
  };
}

export const hmHighmilLubricantesRadar = makeMorelosBusinessRadar({
  key: "hm_highmil_lubricantes_morelos",
  name: "HM HIGHMIL/HIGHMILL — Aceites, aditivos y anticongelantes Morelos",
  description:
    "Vertical comercial interna HM HIGHMIL/HIGHMILL. Detecta licitaciones de aceites, aditivos, grasas, anticongelantes y fluidos automotrices en Morelos.",
  includeTerms: LUBRICANTES_KEYWORDS,
  priority: 2,
});

export const primasaImpresosRadar = makeMorelosBusinessRadar({
  key: "primasa_impresos_morelos",
  name: "PRIMASA — Impresos Morelos",
  description:
    "Vertical comercial interna PRIMASA. Detecta oportunidades de impresos, formatos, boletos, recibos, papeleria institucional y produccion grafica en Morelos.",
  includeTerms: IMPRESOS_KEYWORDS,
  priority: 2,
});

export const coformexImpresosRadar = makeMorelosBusinessRadar({
  key: "coformex_impresos_morelos",
  name: "COFORMEX — Impresos institucionales Morelos",
  description:
    "Vertical comercial interna COFORMEX. Usa el radar de impresos y agrega formatos administrativos, formas continuas y documentacion institucional.",
  includeTerms: [...IMPRESOS_KEYWORDS, ...COFORMEX_IMPRESOS_ADICIONALES],
  priority: 2,
});

export const uniforceSeguridadRiesgoRadar = makeMorelosBusinessRadar({
  key: "uniforce_seguridad_riesgo_morelos",
  name: "UNIFORCE — Seguridad, confianza y analisis de riesgo Morelos",
  description:
    "Vertical comercial interna UNIFORCE. Detecta servicios institucionales de seguridad, vigilancia, control de confianza, psicometria, validacion documental y analisis de riesgo en Morelos.",
  includeTerms: SEGURIDAD_RIESGO_KEYWORDS,
  priority: 2,
  minScore: 0.48,
});

export const grupoConstructorNagRadar = makeMorelosBusinessRadar({
  key: "grupo_constructor_nag_mantenimiento_morelos",
  name: "GRUPO CONSTRUCTOR NAG — Construccion y mantenimiento Morelos",
  description:
    "Vertical comercial interna Grupo Constructor NAG. Detecta obra civil menor, construccion, remodelacion, conservacion y mantenimiento de inmuebles en Morelos.",
  includeTerms: CONSTRUCCION_MANTENIMIENTO_KEYWORDS,
  priority: 2,
  minScore: 0.5,
});

export const BUSINESS_LINE_RADARS: RadarConfig[] = [
  hmHighmilLubricantesRadar,
  primasaImpresosRadar,
  coformexImpresosRadar,
  uniforceSeguridadRiesgoRadar,
  grupoConstructorNagRadar,
];
