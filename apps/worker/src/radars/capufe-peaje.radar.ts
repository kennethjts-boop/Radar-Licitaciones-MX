/**
 * RADAR: capufe_peaje
 * Detecta licitaciones de insumos y equipos para casetas de peaje en CAPUFE.
 */
import type { RadarConfig } from '../types/procurement';

export const capufePeajeRadar: RadarConfig = {
  key: 'capufe_peaje',
  name: 'CAPUFE — Insumos y Equipos de Caseta de Peaje',
  description:
    'Detecta licitaciones de CAPUFE para comprobantes de peaje, insumos de impresión, terminales de cobro y equipamiento de plaza de cobro.',
  isActive: true,
  priority: 1,
  scheduleMinutes: 30,
  minScore: 0.35,

  includeTerms: [
    // Institucional
    'capufe',
    'caminos y puentes federales',
    'plaza de cobro',
    'caseta de cobro',
    'caseta de peaje',

    // Comprobantes
    'comprobantes de caseta',
    'comprobantes de peaje',
    'comprobante de peaje',
    'comprobante fiscal',
    'rollos termicos',
    'rollos térmicos',
    'rollo termico',
    'papel termico',
    'papel térmico',
    'ticket',
    'tickets',
    'papel para recibo',
    'comprobantes preimpresos',
    'formatos preimpresos',
    'folios',

    // Impresoras
    'impresoras termicas',
    'impresoras térmicas',
    'impresora termica',
    'impresoras de recibos',
    'consumibles de impresion',
    'consumibles de impresión',
    'refacciones de impresoras',
    'cabezales',
    'ribbons',
    'tinta',
    'cintas de impresion',

    // Terminales y equipos
    'terminales de cobro',
    'terminal de cobro',
    'equipos de caseta',
    'sistema de peaje',
    'insumos de peaje',
    'carril de cobro',

    // Genérico relevante
    'consumibles',
  ],

  excludeTerms: [
    'vehiculo',
    'ambulancia',
    'inmueble',
    'construccion',
    'obra civil',
  ],

  geoTerms: [],

  entityTerms: [
    'capufe',
    'caminos y puentes federales de ingresos y servicios conexos',
  ],

  rules: [
    {
      ruleType: 'entity',
      fieldName: 'dependency_name',
      operator: 'any_of',
      value: ['capufe', 'caminos y puentes'],
      weight: 0.4,
      isRequired: false,
    },
    {
      ruleType: 'keyword',
      fieldName: 'canonical_text',
      operator: 'any_of',
      value: [
        'peaje',
        'caseta',
        'rollos termicos',
        'papel termico',
        'ticket',
        'impresoras termicas',
        'terminal de cobro',
        'insumos de peaje',
        'comprobantes',
      ],
      weight: 0.6,
      isRequired: true,
    },
  ],
};
