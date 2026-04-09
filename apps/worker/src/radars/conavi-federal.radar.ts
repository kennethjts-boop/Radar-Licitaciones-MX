/**
 * RADAR: conavi_federal
 * Detecta licitaciones de CONAVI a nivel federal.
 */
import type { RadarConfig } from '../types/procurement';

export const conaviFederalRadar: RadarConfig = {
  key: 'conavi_federal',
  name: 'CONAVI — Federal (Vivienda y Subsidios)',
  description:
    'Detecta licitaciones de la Comisión Nacional de Vivienda para subsidios, supervisión, obra habitacional y consultoría.',
  isActive: true,
  priority: 2,
  scheduleMinutes: 30,
  minScore: 0.35,

  includeTerms: [
    // Institucional
    'conavi',
    'comision nacional de vivienda',
    'comisión nacional de vivienda',

    // Vivienda
    'vivienda',
    'vivienda social',
    'vivienda digna',
    'vivienda popular',
    'subsidios de vivienda',
    'subsidio de vivienda',
    'padrones de beneficiarios',
    'padron de beneficiarios',
    'padrón de beneficiarios',

    // Supervisión y obra
    'supervision de obra',
    'supervisión de obra',
    'supervision tecnica',
    'verificacion de obra',
    'mejoramiento de vivienda',
    'obra habitacional',
    'acciones de vivienda',
    'soluciones habitacionales',

    // Estudios y consultoría
    'diagnosticos territoriales',
    'diagnósticos territoriales',
    'estudios de vivienda',
    'geoestadistica',
    'geoestadística',
    'consultoría',
    'consultoria',
    'evaluacion de programas',
    'evaluación de programas',

    // Programas
    'tu casa',
    'esta es tu casa',
    'habitat',
    'paspam',
  ],

  excludeTerms: [
    'carretera',
    'autopista',
    'peaje',
    'caseta',
  ],

  geoTerms: [],

  entityTerms: [
    'conavi',
    'comision nacional de vivienda',
  ],

  rules: [
    {
      ruleType: 'entity',
      fieldName: 'dependency_name',
      operator: 'any_of',
      value: ['conavi', 'comision nacional de vivienda'],
      weight: 0.6,
      isRequired: true,
    },
    {
      ruleType: 'keyword',
      fieldName: 'canonical_text',
      operator: 'any_of',
      value: ['vivienda', 'subsidio', 'habitacional', 'supervision', 'geoestadistica'],
      weight: 0.4,
      isRequired: false,
    },
  ],
};
