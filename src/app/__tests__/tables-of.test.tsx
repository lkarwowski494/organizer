/** Audyt 3, N-15: tabele ekranów liczone raz na `base` i `pending` — nowy stan z samymi kursorami ich nie zmienia. */
import { initialState, mutate } from '../../domain/sync-engine/client';
import { tablesOf } from '../context';

it('ten sam base i ta sama kolejka → te same tabele; zmiana którejkolwiek → nowe', () => {
  const s = { ...initialState('c'), base: { groups: { g: { id: 'g', name: 'Rodzina', version: 1 } } } };
  const t = tablesOf(s);
  expect(tablesOf({ ...s, cursors: { g: 7 }, purged: { g: 2 } })).toBe(t);
  const changed = mutate(s, { kind: 'patch', entity: 'groups', id: 'g', set: { name: 'Dom' } }, () => 'op-1');
  expect(tablesOf(changed)).not.toBe(t);
  expect(tablesOf(changed).groups!.g).toMatchObject({ name: 'Dom' });
  expect(tablesOf({ ...s, base: { ...s.base } })).not.toBe(t);
});
