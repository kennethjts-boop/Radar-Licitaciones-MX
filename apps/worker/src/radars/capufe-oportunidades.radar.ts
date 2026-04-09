/**
 * RADAR: capufe_oportunidades
 * Detecta oportunidades en licitaciones CAPUFE: desiertas, canceladas,
 * con baja competencia, reposiciones o segundas vueltas.
 */
import type { RadarConfig } from '../types/procurement';

export const capufeOportunidadesRadar: RadarConfig = {
  key: 'capufe_oportunidades',
  name: 'CAPUFE — Oportunidades (Desiertas / Baja Competencia)',
  description:
    'Detecta licitaciones de CAPUFE que quedaron desiertas, canceladas, o con baja competencia, incluyendo reposiciones y segundas vueltas.',
  isActive: true,
  priority: 2,
  scheduleMinutes: 30,
  minScore: 0.3,

  includeTerms: [
    // Institucional
    'capufe',
    'caminos y puentes federales',

    // Estatus de oportunidad
    'desierta',
    'licitacion desierta',
    'licitación desierta',
    'cancelada',
    'licitacion cancelada',
    'reposicion',
    'reposición',
    'segunda vuelta',
    'segunda convocatoria',
    'nueva convocatoria',
    'baja competencia',
    'sin proposiciones',
    'sin propuestas',
    'sin participantes',
    'propuesta unica',
    'propuesta única',
    'solo un licitante',
  ],

  excludeTerms: [],

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
      ruleType: 'status',
      fieldName: 'status',
      operator: 'any_of',
      value: ['desierta', 'cancelada'],
      weight: 0.6,
      isRequired: false,
    },
    {
      ruleType: 'keyword',
      fieldName: 'canonical_text',
      operator: 'any_of',
      value: [
        'desierta',
        'cancelada',
        'reposicion',
        'segunda vuelta',
        'baja competencia',
        'sin proposiciones',
      ],
      weight: 0.5,
      isRequired: false,
    },
  ],
};
