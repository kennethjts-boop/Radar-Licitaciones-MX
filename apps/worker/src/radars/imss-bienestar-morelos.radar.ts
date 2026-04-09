/**
 * RADAR: imss_bienestar_morelos
 * Detecta licitaciones de IMSS-Bienestar (antes INSABI) en Morelos.
 */
import type { RadarConfig } from '../types/procurement';

export const imssBienestarMorelosRadar: RadarConfig = {
  key: 'imss_bienestar_morelos',
  name: 'IMSS Bienestar — Morelos (Hospitales Comunitarios)',
  description:
    'Detecta licitaciones de IMSS-Bienestar en Morelos para hospitales comunitarios, centros de salud, medicamentos y equipamiento rural.',
  isActive: true,
  priority: 1,
  scheduleMinutes: 30,
  minScore: 0.35,

  includeTerms: [
    // Institucional
    'imss bienestar',
    'imss-bienestar',
    'bienestar',
    'insabi',

    // Unidades de atención
    'hospital comunitario',
    'hospitales comunitarios',
    'centros de salud',
    'centro de salud',
    'unidad rural',
    'unidades rurales',
    'casa de salud',

    // Medicamentos e insumos
    'medicamentos',
    'medicamento',
    'material de curación',
    'material de curacion',
    'insumos para la salud',
    'material medico',
    'vacunas',
    'vacunacion',
    'vacunación',
    'cadena de frio',
    'cadena de frío',
    'refrigeracion',
    'refrigeración',

    // Equipamiento
    'equipamiento medico',
    'equipamiento médico',
    'mobiliario clínico',
    'mobiliario clinico',
    'laboratorio',
    'laboratorio rural',

    // Transporte y logística
    'transporte',
    'ambulancia',
    'vehiculo sanitario',
    'vehículo sanitario',
  ],

  excludeTerms: [
    'imss delegacion',
    'ooad',
    'zona urbana consolidada',
  ],

  geoTerms: [
    'morelos',
    'cuernavaca',
    'cuautla',
    'jojutla',
    'tlaltizapan',
    'axochiapan',
    'tetecala',
    'miacatlan',
    'yecapixtla',
    'zacatepec',
  ],

  entityTerms: [
    'imss bienestar',
    'imss-bienestar',
    'insabi',
  ],

  rules: [
    {
      ruleType: 'entity',
      fieldName: 'dependency_name',
      operator: 'any_of',
      value: ['imss bienestar', 'imss-bienestar', 'insabi'],
      weight: 0.5,
      isRequired: false,
    },
    {
      ruleType: 'keyword',
      fieldName: 'canonical_text',
      operator: 'any_of',
      value: [
        'hospital comunitario',
        'centro de salud',
        'unidad rural',
        'cadena de frio',
        'vacunacion',
      ],
      weight: 0.5,
      isRequired: false,
    },
    {
      ruleType: 'geo',
      fieldName: 'canonical_text',
      operator: 'contains',
      value: 'morelos',
      weight: 0.4,
      isRequired: false,
    },
  ],
};
