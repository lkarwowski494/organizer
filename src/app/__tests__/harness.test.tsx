/**
 * Udawany serwer testów ekranów (audyt 2, M-50, M-156): odrzuca to, co odrzuciłby serwer, a odrzucenie zapowiedziane
 * przez test (`expectRejected`) nie oblewa testu; `expectOps` sprawdza dokładnie operacje od poprzedniego sprawdzenia.
 */
import { initialState } from '../../domain/sync-engine/client';
import { expectOps, memoryStore, sampleBase } from './harness';

const fresh = () => memoryStore({ ...initialState('c-test'), base: sampleBase() });

describe('udawany serwer w testach ekranów', () => {
  it('operacja dozwolona: brak odrzuceń; operacja w cudzej grupie: odrzucona z kodem serwera', () => {
    const store = fresh();
    store.dispatch({ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { title: 'Kwiaty' } });
    expect(store.rejected).toEqual([]);
    const foreign = { kind: 'create', entity: 'tasks', id: 'x-1', group_id: 'g-obca', set: { list_id: 'lf', parent_id: null, title: 'x', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } } as const;
    store.dispatch(foreign);
    expect(store.rejected).toEqual([{ op: foreign, code: 'forbidden' }]);
    expect(store.unexpected()).toEqual([`forbidden: ${JSON.stringify(foreign)}`]);
    // Zapowiedź z innym kodem nie wystarcza; z tym samym — odrzucenie jest oczekiwane.
    store.expectRejected('unauthorized');
    expect(store.unexpected()).toHaveLength(1);
    store.expectRejected('forbidden');
    expect(store.unexpected()).toEqual([]);
    expectOps(store, [{ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { title: 'Kwiaty' } }, foreign]);
  });

  it('expectOps: tylko operacje od poprzedniego sprawdzenia, dokładnie (nadmiarowe pole oblewa)', () => {
    const store = fresh();
    expect(store.opsChecked).toBe(false);
    store.dispatch({ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { title: 'A', note: null } });
    expect(() => expectOps(store, [{ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { title: 'A' } }])).toThrow();
    expect(store.opsChecked).toBe(true);
    store.dispatch({ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { title: 'B' } });
    expectOps(store, [{ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { title: 'B' } }]);
    expectOps(store, []);
    expect(store.opsMark).toBe(2);
  });
});
