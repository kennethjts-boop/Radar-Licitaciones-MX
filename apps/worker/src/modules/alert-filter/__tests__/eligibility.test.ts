import { classifyAlert } from '../eligibility';
import type { NormalizedProcurement } from '../../../types/procurement';
import type { UpsertProcurementResult } from '../../../storage/procurement.repo';
import type { AlertFilterOptions } from '../types';

const OPTIONS: AlertFilterOptions = { desertaLookbackDays: 10, activeMaxAgeDays: 21 };

const NOW = new Date('2026-05-06T12:00:00Z');
const FUTURE = '2026-06-01T10:00:00';
const PAST = '2026-03-01T10:00:00';
const RECENT = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
const OLD = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();

function makeItem(
  status: string,
  openingDate: string | null = null,
  fetchedAt = RECENT,
  rawJson: Record<string, unknown> = {},
): NormalizedProcurement {
  return {
    source: 'comprasmx', sourceUrl: 'https://example.com', externalId: 'X-001',
    expedienteId: null, licitationNumber: null, procedureNumber: null,
    title: 'Test', description: null, dependencyName: null, buyingUnit: null,
    procedureType: 'licitacion_publica', status: status as any,
    publicationDate: null, openingDate, awardDate: null,
    state: null, municipality: null, amount: null, currency: null,
    attachments: [], canonicalText: 'test', canonicalFingerprint: 'abc',
    lightweightFingerprint: null, canonicalHash: null, rawJson, fetchedAt,
  };
}

function makeUpsert(isNew: boolean): UpsertProcurementResult {
  return { isNew, isUpdated: !isNew, procurementId: 'uuid-1', changedFields: {}, versionNumber: 1 };
}

describe('classifyAlert — CASO A: isNew=true', () => {
  it('ALERTABLE para nueva activa sin fechas', () => {
    const result = classifyAlert(makeItem('activa'), makeUpsert(true), OPTIONS, NOW);
    expect(result.decision).toBe('ALERTABLE');
    expect(result.reason).toBe('new_active');
  });

  it('ALERTABLE para nueva publicada con fecha futura', () => {
    const result = classifyAlert(makeItem('publicada', FUTURE), makeUpsert(true), OPTIONS, NOW);
    expect(result.decision).toBe('ALERTABLE');
    expect(result.reason).toBe('new_active');
  });

  it('NOT_ALERTABLE para nueva pero adjudicada', () => {
    const result = classifyAlert(makeItem('adjudicada'), makeUpsert(true), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('new_but_awarded');
  });

  it('NOT_ALERTABLE para nueva pero cancelada', () => {
    const result = classifyAlert(makeItem('cancelada'), makeUpsert(true), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('new_but_cancelled');
  });

  it('NOT_ALERTABLE para nueva pero cerrada', () => {
    const result = classifyAlert(makeItem('cerrada'), makeUpsert(true), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('new_but_closed');
  });

  it('ALERTABLE para nueva desierta reciente', () => {
    const item = makeItem('desierta', null, RECENT);
    const result = classifyAlert(item, makeUpsert(true), OPTIONS, NOW);
    expect(result.decision).toBe('ALERTABLE');
    expect(result.reason).toBe('new_desierta');
  });

  it('NOT_ALERTABLE para nueva desierta pero vieja', () => {
    const item = makeItem('desierta', null, OLD);
    const result = classifyAlert(item, makeUpsert(true), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('desierta_too_old');
  });
});

describe('classifyAlert — CASO B: isNew=false', () => {
  it('ALERTABLE para activa con fecha de apertura futura', () => {
    const result = classifyAlert(makeItem('activa', FUTURE), makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('ALERTABLE');
    expect(result.reason).toBe('active_with_future_dates');
  });

  it('ALERTABLE para activa con fecha_fallo futura en rawJson', () => {
    const item = makeItem('activa', PAST, RECENT, { fecha_fallo: FUTURE });
    const result = classifyAlert(item, makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('ALERTABLE');
    expect(result.reason).toBe('active_with_future_dates');
  });

  it('NOT_ALERTABLE para activa con todas las fechas pasadas', () => {
    const item = makeItem('activa', PAST, OLD, { fecha_fallo: PAST });
    const result = classifyAlert(item, makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('old_no_future_dates');
  });

  it('NOT_ALERTABLE para adjudicada vieja', () => {
    const result = classifyAlert(makeItem('adjudicada', PAST, OLD), makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('old_closed_status');
  });

  it('ALERTABLE para desierta reciente (por fetchedAt)', () => {
    const item = makeItem('desierta', PAST, RECENT);
    const result = classifyAlert(item, makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('ALERTABLE');
    expect(result.reason).toBe('recent_desierta');
  });

  it('NOT_ALERTABLE para desierta con fetchedAt viejo', () => {
    const item = makeItem('desierta', PAST, OLD);
    const result = classifyAlert(item, makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('desierta_too_old');
  });

  it('NOT_ALERTABLE para UNKNOWN vieja', () => {
    const result = classifyAlert(makeItem('unknown', PAST, OLD), makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('unknown_status_old');
  });

  it('NOT_ALERTABLE para activa no-nueva con publicationDate > activeMaxAgeDays', () => {
    const item = { ...makeItem('activa', FUTURE), publicationDate: OLD };
    const result = classifyAlert(item, makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('NOT_ALERTABLE');
    expect(result.reason).toBe('too_old_not_new');
  });

  it('ALERTABLE para activa no-nueva con publicationDate reciente y fecha futura', () => {
    const item = { ...makeItem('activa', FUTURE), publicationDate: RECENT };
    const result = classifyAlert(item, makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('ALERTABLE');
    expect(result.reason).toBe('active_with_future_dates');
  });

  it('ALERTABLE para activa no-nueva con publicationDate null y fecha futura (age check saltado)', () => {
    const result = classifyAlert(makeItem('activa', FUTURE), makeUpsert(false), OPTIONS, NOW);
    expect(result.decision).toBe('ALERTABLE');
    expect(result.reason).toBe('active_with_future_dates');
  });
});
