/** Retencja na telefonie (audyt 2, M-62, M-68): te same terminy co sprzątanie serwera. */
import { config } from '../../config';
import { initialState } from '../sync-engine/client';
import { pruneExpired } from '../sync-engine/retention';

const NOW = Date.parse('2026-10-07T10:00:00Z');
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe('pruneExpired', () => {
  it('historia: starsza niż ACTIVITY_DAYS znika, młodsza i bez daty zostają', () => {
    const s = {
      ...initialState('c'),
      base: {
        activity: {
          old: { id: 'old', created_at: ago(config.retention.ACTIVITY_DAYS + 1) },
          edge: { id: 'edge', created_at: ago(config.retention.ACTIVITY_DAYS - 1) },
          nodate: { id: 'nodate' },
        },
        tasks: { t: { id: 't', created_at: ago(1000) } },
      },
    };
    const out = pruneExpired(s, NOW);
    expect(Object.keys(out.base.activity!)).toEqual(['edge', 'nodate']);
    // Inne tabele bez zmian (ten sam obiekt).
    expect(out.base.tasks).toBe(s.base.tasks);
  });

  it('przekazania: rozstrzygnięte po HANDOFF_DAYS od decyzji znikają, oczekujące zostają', () => {
    const old = ago(config.retention.HANDOFF_DAYS + 1);
    const s = {
      ...initialState('c'),
      base: {
        handoffs: {
          a: { id: 'a', status: 'accepted', decided_at: old },
          d: { id: 'd', status: 'declined', decided_at: ago(1) },
          p: { id: 'p', status: 'pending', decided_at: old },
          n: { id: 'n', status: 'cancelled', decided_at: null },
        },
      },
    };
    expect(Object.keys(pruneExpired(s, NOW).base.handoffs!)).toEqual(['d', 'p', 'n']);
  });

  it('nic po terminie albo brak tabel — ten sam stan (bez zapisu)', () => {
    const empty = initialState('c');
    expect(pruneExpired(empty, NOW)).toBe(empty);
    const s = { ...empty, base: { activity: { a: { id: 'a', created_at: ago(1) } } } };
    expect(pruneExpired(s, NOW)).toBe(s);
  });
});
