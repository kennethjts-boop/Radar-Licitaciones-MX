/**
 * RADAR: capufe_mantenimiento_equipos
 * Detecta licitaciones de CAPUFE para mantenimiento, servicios y equipamiento
 * de casetas de cobro: control de tránsito, sistemas electrónicos, señalización,
 * papelería operativa, refacciones y servicios de conservación.
 */
import type { RadarConfig } from "../types/procurement";

export const capufeMantenimientoEquiposRadar: RadarConfig = {
  key: "capufe_mantenimiento_equipos",
  name: "CAPUFE — Mantenimiento y Equipos de Caseta",
  description:
    "Detecta licitaciones de CAPUFE para mantenimiento, servicios y equipamiento de casetas de cobro: control de tránsito, sistemas electrónicos, señalización, papelería operativa, refacciones y servicios de conservación.",
  isActive: true,
  priority: 1,
  scheduleMinutes: 30,
  minScore: 0.35,

  includeTerms: [
    // Institucional
    "capufe",
    "caminos y puentes federales",
    "plaza de cobro",
    "caseta de cobro",
    "caseta de peaje",
    "autopista federal",
    "red carretera federal",

    // Control de tránsito
    "control de transito",
    "control de tránsito",
    "equipo de control de transito",
    "equipo de control de tránsito",
    "sistema de control de transito",
    "dispositivos de control de transito",
    "señalizacion vial",
    "señalización vial",
    "semaforos",
    "semáforos",
    "its",
    "sistemas inteligentes de transporte",
    "aforo vehicular",
    "conteo vehicular",
    "lazos inductivos",
    "sensores de trafico",
    "camaras de vigilancia vial",
    "cctv caseta",
    "barreras vehiculares",
    "plumas de caseta",

    // Mantenimiento y servicios
    "mantenimiento preventivo",
    "mantenimiento correctivo",
    "servicio de mantenimiento",
    "conservacion",
    "conservación",
    "mantenimiento a equipo",
    "mantenimiento de equipo",
    "servicios de conservacion",
    "reparacion de equipo",
    "refacciones",
    "refaccionamiento",

    // Sistemas electrónicos y cobro
    "sistema electronico de cobro",
    "telepeaje",
    "tag",
    "iave",
    "televia",
    "lector rfid",
    "antena rfid",
    "terminal punto de venta",
    "sistema de cobro electronico",
    "ocr placas",
    "reconocimiento de placas",

    // Papelería y consumibles operativos
    "papel termico",
    "papel térmico",
    "rollos termicos",
    "rollos térmicos",
    "comprobantes preimpresos",
    "formatos preimpresos",
    "folios",
    "boletos",
    "papeleria operativa",
    "papelería operativa",
    "etiquetas",
    "ribbons",
    "tinta",
    "toner",
    "consumibles",

    // Infraestructura de caseta
    "caseta prefabricada",
    "mobiliario de caseta",
    "cabina de cobro",
    "iluminacion de caseta",
    "aire acondicionado caseta",

    // Genéricos relevantes
    "equipamiento",
    "instalacion",
    "instalación",
  ],

  excludeTerms: [
    "vehiculo operativo",
    "ambulancia",
    "construccion de puente",
    "construccion de autopista",
    "pavimentacion",
    "repavimentacion",
    "obra civil mayor",
    "carpeta asfaltica",
    "puente vehicular nuevo",
  ],

  geoTerms: [],

  entityTerms: [
    "capufe",
    "caminos y puentes federales de ingresos y servicios conexos",
  ],

  rules: [
    {
      ruleType: "entity",
      fieldName: "dependency_name",
      operator: "any_of",
      value: ["capufe", "caminos y puentes"],
      weight: 0.4,
      isRequired: false,
    },
    {
      ruleType: "keyword",
      fieldName: "canonical_text",
      operator: "any_of",
      value: [
        "control de transito",
        "señalizacion vial",
        "semaforos",
        "telepeaje",
        "iave",
        "televia",
        "tag",
        "mantenimiento a equipo",
        "mantenimiento de equipo",
        "rollos termicos",
        "papel termico",
        "comprobantes",
        "cctv caseta",
        "barreras vehiculares",
        "aforo vehicular",
        "sistema electronico de cobro",
        "refacciones",
        "its",
        "plumas de caseta",
        "caseta",
      ],
      weight: 0.6,
      isRequired: true,
    },
  ],
};
