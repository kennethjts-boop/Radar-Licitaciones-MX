import type { NormalizedProcurement } from '../../types/procurement';
import type { UpsertProcurementResult } from '../../storage/procurement.repo';

export interface SampleEntry {
  item: NormalizedProcurement;
  upsertResult: UpsertProcurementResult;
  category: string;
}

const NOW = new Date();
const future = (days: number) =>
  new Date(NOW.getTime() + days * 86_400_000).toISOString().replace('Z', '');
const past = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString().replace('Z', '');

let _seq = 0;
function makeEntry(
  category: string,
  status: string,
  isNew: boolean,
  openingDate: string | null,
  fetchedAt: string,
  rawJson: Record<string, unknown> = {},
): SampleEntry {
  _seq++;
  return {
    category,
    item: {
      source: 'comprasmx',
      sourceUrl: `https://example.com/${_seq}`,
      externalId: `EXT-${_seq.toString().padStart(4, '0')}`,
      expedienteId: null,
      licitationNumber: `LIC-${_seq}`,
      procedureNumber: null,
      title: `Licitación de prueba ${_seq} — ${category}`,
      description: null,
      dependencyName: `Dependencia ${_seq % 10}`,
      buyingUnit: null,
      procedureType: 'licitacion_publica',
      status: status as any,
      publicationDate: fetchedAt,
      openingDate,
      awardDate: null,
      state: 'Morelos',
      municipality: null,
      amount: 100_000 + _seq * 1_000,
      currency: 'MXN',
      attachments: [],
      canonicalText: `licitacion prueba ${_seq}`,
      canonicalFingerprint: `fp-${_seq}`,
      lightweightFingerprint: null,
      canonicalHash: null,
      rawJson,
      fetchedAt,
    },
    upsertResult: {
      isNew,
      isUpdated: !isNew,
      procurementId: `uuid-${_seq}`,
      changedFields: {},
      versionNumber: 1,
    },
  };
}

export function generateSampleData(): SampleEntry[] {
  _seq = 0;
  const entries: SampleEntry[] = [];

  // 80 cerradas de marzo (viejas, isNew=false)
  for (let i = 0; i < 80; i++) {
    entries.push(makeEntry('old_closed_march', 'cerrada', false, past(60 + i), past(60 + i)));
  }

  // 40 adjudicadas (isNew=false)
  for (let i = 0; i < 40; i++) {
    entries.push(makeEntry('awarded', 'adjudicada', false, past(45 + i), past(45 + i)));
  }

  // 30 canceladas (isNew=false)
  for (let i = 0; i < 30; i++) {
    entries.push(makeEntry('cancelled', 'cancelada', false, past(30 + i), past(30 + i)));
  }

  // 20 históricas activas pero viejas sin fechas futuras (isNew=false)
  for (let i = 0; i < 20; i++) {
    entries.push(makeEntry('historical', 'activa', false, past(35), past(35)));
  }

  // 25 duplicadas (mismo externalId que las primeras 25)
  for (let i = 0; i < 25; i++) {
    const dup: SampleEntry = {
      ...entries[i],
      category: 'duplicate',
    };
    entries.push(dup);
  }

  // 35 activas recientes nuevas con fechas futuras
  for (let i = 0; i < 35; i++) {
    entries.push(makeEntry('new_active', 'activa', true, future(3 + i), past(1)));
  }

  // 10 desiertas recientes (dentro de ventana de 10 días)
  for (let i = 0; i < 10; i++) {
    entries.push(makeEntry('recent_desierta', 'desierta', false, past(60), past(5 + i)));
  }

  // 10 activas ya en DB con fechas futuras (no nuevas)
  for (let i = 0; i < 10; i++) {
    entries.push(makeEntry('active_future_dates', 'activa', false, future(7 + i), past(3)));
  }

  return entries;
}
