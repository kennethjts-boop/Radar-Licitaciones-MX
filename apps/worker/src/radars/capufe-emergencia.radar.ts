/**
 * RADAR: capufe_emergencia
 * Detecta licitaciones de vehículos y equipamiento de emergencia en CAPUFE.
 */
import type { RadarConfig } from '../types/procurement';

export const capufeEmergenciaRadar: RadarConfig = {
  key: 'capufe_emergencia',
  name: 'CAPUFE — Vehículos y Equipamiento de Emergencia',
  description:
    'Detecta licitaciones de CAPUFE relacionadas con vehículos de emergencia, grúas, ambulancias, y equipamiento para auxilio vial.',
  isActive: true,
  priority: 1,
  scheduleMinutes: 30,
  minScore: 0.4,

  includeTerms: [
    // Institucional
    'capufe',
    'caminos y puentes federales',

    // Vehículos de emergencia
    'vehiculos de emergencia',
    'vehiculo de emergencia',
    'vehiculo emergencia',
    'ambulancia',
    'ambulancias',
    'grúa',
    'grua',
    'grúas',
    'auxilio vial',
    'rescate',
    'patrulla carretera',
    'unidad médica móvil',
    'unidad medica movil',

    // Mantenimiento vehicular
    'mantenimiento vehicular',
    'mantenimiento de vehiculos',
    'mantenimiento de flota',
    'flota vehicular',
    'refacciones',
    'refacciones vehiculares',
    'servicio de mantenimiento',

    // Equipamiento de emergencia
    'torretas',
    'torreta',
    'sirenas',
    'sirena',
    'radio movil',
    'radio móvil',
    'balizamiento',
    'baliza',
    'carrocería',
    'carroceria',
    'adaptacion vehicular',
    'adaptación vehicular',
  ],

  excludeTerms: [
    'inmueble',
    'software',
    'servicios profesionales',
    'consultoría',
    'limpieza de edificios',
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
      value: ['capufe', 'caminos y puentes federales'],
      weight: 0.5,
      isRequired: false,
    },
    {
      ruleType: 'keyword',
      fieldName: 'canonical_text',
      operator: 'any_of',
      value: [
        'emergencia',
        'ambulancia',
        'grua',
        'auxilio vial',
        'mantenimiento vehicular',
        'refacciones',
        'torretas',
        'sirenas',
      ],
      weight: 0.5,
      isRequired: true,
    },
  ],
};
