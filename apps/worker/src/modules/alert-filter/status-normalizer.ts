import type { NormalizedTenderStatus } from './types';

/** Elimina acentos y convierte a minúsculas para comparar */
const n = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Orden de evaluación importa: DESIERTA antes que CLOSED/EXPIRED
const TERM_MAP: Array<[NormalizedTenderStatus, string[]]> = [
  ['DESIERTA', ['desierta', 'declarada desierta', 'sin adjudicacion', 'procedimiento desierto']],
  ['CANCELLED', ['cancelada', 'suspendida', 'anulada']],
  ['EXPIRED', ['vencida', 'fecha limite vencida', 'presentacion vencida', 'apertura vencida']],
  ['AWARDED', ['adjudicada', 'contrato adjudicado', 'fallo adjudicado', 'con ganador']],
  ['CLOSED', ['cerrada', 'concluida', 'terminada', 'finalizada']],
  [
    'ACTIVE',
    [
      'publicada', 'vigente', 'activa', 'abierta', 'en_proceso', 'en proceso',
      'convocatoria', 'recepcion de proposiciones', 'junta de aclaraciones',
      'fallo pendiente', 'apertura pendiente',
    ],
  ],
];

export function normalizeTenderStatus(
  rawStatus: string | null | undefined,
): NormalizedTenderStatus {
  if (!rawStatus) return 'UNKNOWN';
  const normalized = n(rawStatus);
  for (const [status, terms] of TERM_MAP) {
    if (terms.some((t) => normalized.includes(n(t)))) return status;
  }
  return 'UNKNOWN';
}
