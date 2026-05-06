import { extractTenderDates, isTenderStillActionable, isWithinDays } from '../date-utils';
import type { NormalizedProcurement } from '../../../types/procurement';

function makeProcurement(overrides: Partial<NormalizedProcurement> = {}): NormalizedProcurement {
  return {
    source: 'comprasmx',
    sourceUrl: 'https://example.com',
    externalId: 'TEST-001',
    expedienteId: null,
    licitationNumber: null,
    procedureNumber: null,
    title: 'Test',
    description: null,
    dependencyName: null,
    buyingUnit: null,
    procedureType: 'licitacion_publica',
    status: 'activa',
    publicationDate: null,
    openingDate: null,
    awardDate: null,
    state: null,
    municipality: null,
    amount: null,
    currency: null,
    attachments: [],
    canonicalText: 'test',
    canonicalFingerprint: 'abc',
    lightweightFingerprint: null,
    canonicalHash: null,
    rawJson: {},
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('extractTenderDates', () => {
  it('extrae openingDate del campo directo', () => {
    const item = makeProcurement({ openingDate: '2026-06-01T10:00:00' });
    const dates = extractTenderDates(item);
    expect(dates.openingDate).not.toBeNull();
  });

  it('extrae rulingDate de rawJson.fecha_fallo', () => {
    const item = makeProcurement({ rawJson: { fecha_fallo: '2026-06-15T10:00:00' } });
    const dates = extractTenderDates(item);
    expect(dates.rulingDate).not.toBeNull();
  });

  it('extrae clarificationDate de rawJson.fecha_aclaraciones', () => {
    const item = makeProcurement({ rawJson: { fecha_aclaraciones: '2026-05-20T10:00:00' } });
    const dates = extractTenderDates(item);
    expect(dates.clarificationDate).not.toBeNull();
  });

  it('retorna null para campos ausentes', () => {
    const item = makeProcurement();
    const dates = extractTenderDates(item);
    expect(dates.publicationDate).toBeNull();
    expect(dates.openingDate).toBeNull();
    expect(dates.rulingDate).toBeNull();
    expect(dates.clarificationDate).toBeNull();
  });
});

describe('isTenderStillActionable', () => {
  const now = new Date('2026-05-06T12:00:00Z');

  it('retorna true si openingDate es futura', () => {
    const dates = {
      publicationDate: null,
      openingDate: new Date('2026-06-01T10:00:00Z'),
      rulingDate: null,
      clarificationDate: null,
      firstSeenAt: null,
    };
    expect(isTenderStillActionable(dates, now)).toBe(true);
  });

  it('retorna true si rulingDate es futura aunque openingDate pasó', () => {
    const dates = {
      publicationDate: null,
      openingDate: new Date('2026-04-01T10:00:00Z'),
      rulingDate: new Date('2026-06-01T10:00:00Z'),
      clarificationDate: null,
      firstSeenAt: null,
    };
    expect(isTenderStillActionable(dates, now)).toBe(true);
  });

  it('retorna false si todas las fechas ya pasaron', () => {
    const dates = {
      publicationDate: null,
      openingDate: new Date('2026-03-01T10:00:00Z'),
      rulingDate: new Date('2026-03-15T10:00:00Z'),
      clarificationDate: new Date('2026-02-20T10:00:00Z'),
      firstSeenAt: null,
    };
    expect(isTenderStillActionable(dates, now)).toBe(false);
  });

  it('retorna true si no hay ninguna fecha (beneficio de la duda)', () => {
    const dates = {
      publicationDate: null,
      openingDate: null,
      rulingDate: null,
      clarificationDate: null,
      firstSeenAt: null,
    };
    expect(isTenderStillActionable(dates, now)).toBe(true);
  });
});

describe('isWithinDays', () => {
  const now = new Date('2026-05-06T12:00:00Z');

  it('retorna true si la fecha está dentro de la ventana', () => {
    const date = new Date('2026-05-04T12:00:00Z');
    expect(isWithinDays(date, 10, now)).toBe(true);
  });

  it('retorna false si la fecha está fuera de la ventana', () => {
    const date = new Date('2026-04-01T12:00:00Z');
    expect(isWithinDays(date, 10, now)).toBe(false);
  });

  it('retorna false para null', () => {
    expect(isWithinDays(null, 10, now)).toBe(false);
  });
});
