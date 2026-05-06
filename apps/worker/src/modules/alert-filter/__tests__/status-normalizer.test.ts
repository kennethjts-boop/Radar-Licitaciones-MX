import { normalizeTenderStatus } from '../status-normalizer';

describe('normalizeTenderStatus', () => {
  it('retorna ACTIVE para "publicada"', () => {
    expect(normalizeTenderStatus('publicada')).toBe('ACTIVE');
  });
  it('retorna ACTIVE para "VIGENTE" (mayúsculas)', () => {
    expect(normalizeTenderStatus('VIGENTE')).toBe('ACTIVE');
  });
  it('retorna ACTIVE para "en_proceso"', () => {
    expect(normalizeTenderStatus('en_proceso')).toBe('ACTIVE');
  });
  it('retorna DESIERTA para "desierta"', () => {
    expect(normalizeTenderStatus('desierta')).toBe('DESIERTA');
  });
  it('retorna DESIERTA para "Declarada Desierta" (mayúsculas + acentos)', () => {
    expect(normalizeTenderStatus('Declarada Desierta')).toBe('DESIERTA');
  });
  it('retorna AWARDED para "adjudicada"', () => {
    expect(normalizeTenderStatus('adjudicada')).toBe('AWARDED');
  });
  it('retorna CANCELLED para "cancelada"', () => {
    expect(normalizeTenderStatus('cancelada')).toBe('CANCELLED');
  });
  it('retorna CLOSED para "cerrada"', () => {
    expect(normalizeTenderStatus('cerrada')).toBe('CLOSED');
  });
  it('retorna CLOSED para "concluida"', () => {
    expect(normalizeTenderStatus('concluida')).toBe('CLOSED');
  });
  it('retorna EXPIRED para "vencida"', () => {
    expect(normalizeTenderStatus('vencida')).toBe('EXPIRED');
  });
  it('retorna UNKNOWN para string vacío', () => {
    expect(normalizeTenderStatus('')).toBe('UNKNOWN');
  });
  it('retorna UNKNOWN para null', () => {
    expect(normalizeTenderStatus(null)).toBe('UNKNOWN');
  });
  it('retorna UNKNOWN para undefined', () => {
    expect(normalizeTenderStatus(undefined)).toBe('UNKNOWN');
  });
  it('retorna UNKNOWN para string sin mapeo conocido', () => {
    expect(normalizeTenderStatus('estado_raro_xyz')).toBe('UNKNOWN');
  });
  it('DESIERTA tiene prioridad sobre CLOSED si el string contiene ambos', () => {
    expect(normalizeTenderStatus('procedimiento desierto cerrado')).toBe('DESIERTA');
  });
});
