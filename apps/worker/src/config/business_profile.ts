export const BUSINESS_PROFILE = {
  // CAPA 1: EL MURO (Si existe alguna de estas, se ignora el archivo de inmediato)
  EXCLUDED_KEYWORDS: [
    "limpieza", "jardinería", "jardineria", "vigilancia", "seguridad privada",
    "fumigación", "fumigacion", "mensajería", "mensajeria", "fotocopiado",
    "copiado", "papelería", "papeleria", "cafetería", "cafeteria",
  ],

  // CAPA 2: NICHOS ESPECÍFICOS (Relevancia Directa)
  CATEGORIES: {
    CAPUFE_VEHICULOS: [
      "ambulancia", "unidad de emergencia", "vehículo de emergencia", "unidad médica móvil",
      "rescate carretero", "grúa", "grúa de arrastre", "camión de rescate", "patrulla",
      "vehículo utilitario", "pick up", "unidad operativa",
    ],
    CAPUFE_PEAJE: [
      "comprobantes de peaje", "rollos térmicos", "papel térmico", "tickets de peaje",
      "insumos de peaje", "sistema de cobro", "sistema de peaje", "control de peaje",
    ],
    CAPUFE_OPORTUNIDADES: [
      "desierta", "procedimiento desierto", "sin participantes", "cancelada",
      "reposición de procedimiento", "segunda convocatoria", "reconvocatoria",
    ],
    CONAVI_FEDERAL: [
      "vivienda", "programa de vivienda", "subsidio de vivienda", "construcción de vivienda",
      "mejoramiento urbano", "urbanización", "infraestructura habitacional",
    ],
    IMSS_MORELOS: [
      "hospital", "clínica", "unidad médica", "equipo médico", "insumos médicos",
      "material de curación", "laboratorio", "servicios médicos", "mantenimiento hospitalario",
    ],
    ISSSTE_CENTRAL: [
      "servicio", "suministro", "adquisición", "contratación", "mantenimiento",
      "equipamiento", "tecnología", "software", "hardware", "consultoría",
    ],
  },
} as const;

export type BusinessCategory = keyof typeof BUSINESS_PROFILE.CATEGORIES;
