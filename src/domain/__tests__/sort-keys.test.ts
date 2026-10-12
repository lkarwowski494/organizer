/** Kolejność zadań (audyt 3: Q37 B, N-130) — klucze ułamkowe, kolejność dodania i przesunięcia. */
import * as fc from 'fast-check';

import { config } from '../../config';
import type { Row } from '../sync-engine/client';
import { appendKey, compareKeys, dropIndex, dueBucket, FIRST_KEY, keyBetween, moveInList, moveOps, moveRange, taskOrder, validKey } from '../views/sort-keys';

const SMALLEST = `A${'0'.repeat(26)}`;
const LARGEST = `z${'z'.repeat(26)}`;

describe('keyBetween — przykłady z README rocicorp/fractional-indexing', () => {
  it('a0, a1, a2; Zz przed a0; a1V między a1 i a2', () => {
    expect(keyBetween(null, null)).toBe('a0');
    expect(keyBetween('a0', null)).toBe('a1');
    expect(keyBetween('a1', null)).toBe('a2');
    expect(keyBetween(null, 'a0')).toBe('Zz');
    expect(keyBetween('a1', 'a2')).toBe('a1V');
  });

  it('licznik rośnie długością dopiero po wyczerpaniu cyfr (az → b00), w dół symetrycznie', () => {
    expect(keyBetween('az', null)).toBe('b00');
    expect(keyBetween('Zz', null)).toBe(FIRST_KEY);
    expect(keyBetween('Yzz', null)).toBe('Z0');
    expect(keyBetween(null, 'b00')).toBe('az');
    expect(keyBetween(null, 'a1')).toBe('a0');
    expect(keyBetween(null, 'Z0')).toBe('Yzz');
    expect(keyBetween(null, 'Zz')).toBe('Zy');
    expect(keyBetween(null, 'a0V')).toBe('a0');
  });

  it('skraje: za największą liczbą i przed najmniejszą dzieli się ułamek', () => {
    expect(keyBetween(LARGEST, null)).toBe(`${LARGEST}V`);
    expect(keyBetween(null, `${SMALLEST}1`)).toBe(`${SMALLEST}0V`);
    expect(keyBetween('a0', 'a0V')).toBe('a0G');
    expect(keyBetween('a0', 'a1')).toBe('a0V');
    expect(keyBetween('a01', 'a02')).toBe('a01V');
    expect(keyBetween('a0z', 'a1')).toBe('a0zV');
    expect(keyBetween('a0', 'a2')).toBe('a1');
    expect(keyBetween('a0', 'a01V')).toBe('a01');
  });

  it('własność: dowolny ciąg wstawień daje poprawne klucze w kolejności wstawiania (wzorzec: tablica pozycji)', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 200 }), (positions) => {
        const keys: string[] = [];
        for (const p of positions) {
          const at = p % (keys.length + 1);
          const k = keyBetween(keys[at - 1] ?? null, keys[at] ?? null);
          expect(validKey(k)).toBe(true);
          expect((keys[at - 1] ?? '') < k && k < (keys[at] ?? '~')).toBe(true);
          keys.splice(at, 0, k);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('dopisywanie na koniec: 10 000 zadań w kilku znakach (limit SORT_KEY)', () => {
    let k = FIRST_KEY;
    for (let i = 0; i < 10_000; i++) k = keyBetween(k, null);
    expect(k.length).toBeLessThanOrEqual(4);
    expect(k.length).toBeLessThan(config.lengths.SORT_KEY);
  });
});

describe('validKey i porównanie', () => {
  it('poza schematem: pusty, bez cyfr całkowitych, obce znaki, zero na końcu ułamka, najmniejsza liczba', () => {
    for (const k of ['', 'a', '!0', 'a0!', 'a00', 'a10', SMALLEST]) expect([k, validKey(k)]).toEqual([k, false]);
    for (const k of ['a0', 'a1V', 'b10', 'Zz', `${SMALLEST}1`, LARGEST]) expect([k, validKey(k)]).toEqual([k, true]);
  });

  it('po kodach znaków (wielkie przed małymi), niezależnie od języka; przy równym kluczu — id', () => {
    expect(['a1', 'Zz', 'a0V', 'a0'].sort(compareKeys)).toEqual(['Zz', 'a0', 'a0V', 'a1']);
    expect(compareKeys('a', 'a')).toBe(0);
    const t = (id: string, sort_key: string) => ({ id, sort_key });
    expect([t('2', 'a0'), t('1', 'a1'), t('0', 'a0')].sort(taskOrder).map((x) => x.id)).toEqual(['0', '2', '1']);
  });
});

describe('appendKey — kolejność dodania', () => {
  const task = (id: string, list: string, parent: string | null, sort_key: string): [string, Row] => [id, { id, list_id: list, parent_id: parent, sort_key, title: id, group_id: 'g' }];
  it('pusta lista — a0; za ostatnim rodzeństwem (także zrobionym i w koszu), bez innych list, rodziców i złych kluczy', () => {
    expect(appendKey({}, 'l', null)).toBe(FIRST_KEY);
    const t = { tasks: Object.fromEntries([task('a', 'l', null, 'a0'), task('b', 'l', null, 'a0'), task('c', 'l', null, 'a5'), task('d', 'l', 'a', 'b00'), task('e', 'x', null, 'c000'), task('f', 'l', null, 'a10')]) };
    expect(appendKey(t, 'l', null)).toBe('a6');
    expect(appendKey(t, 'l', 'a')).toBe('b01');
    expect(appendKey(t, 'l', 'b')).toBe(FIRST_KEY);
  });
});

describe('moveOps — przesunięcie', () => {
  const it3 = (...keys: string[]) => keys.map((sort_key, i) => ({ id: `t${i}`, sort_key }));
  const patch = (id: string, sort_key: string) => ({ kind: 'patch', entity: 'tasks', id, set: { sort_key } });
  it('jedna zmiana — klucz między nowymi sąsiadami (na górę, na dół, w środek)', () => {
    expect(moveOps(it3('a0', 'a1', 'a2'), 2, 0)).toEqual([patch('t2', 'Zz')]);
    expect(moveOps(it3('a0', 'a1', 'a2'), 0, 2)).toEqual([patch('t0', 'a3')]);
    expect(moveOps(it3('a0', 'a1', 'a2'), 0, 1)).toEqual([patch('t0', 'a1V')]);
  });

  it('bez ruchu albo poza listą — nic', () => {
    expect(moveOps(it3('a0', 'a1'), 1, 1)).toEqual([]);
    expect(moveOps(it3('a0', 'a1'), 2, 0)).toEqual([]);
    expect(moveOps(it3('a0', 'a1'), 0, 2)).toEqual([]);
  });

  it('stare równe klucze („a0” wszędzie) albo spoza schematu — cały fragment po kolei, tylko zmienione', () => {
    expect(moveOps(it3('a0', 'a0', 'a0'), 2, 1)).toEqual([patch('t2', 'a1'), patch('t1', 'a2')]);
    expect(moveOps(it3('a0', 'a10', 'a2'), 0, 1)).toEqual([patch('t1', 'a0'), patch('t0', 'a1')]);
  });

  it('klucz dłuższy niż limit — nowe klucze dla całego fragmentu', () => {
    const long = `a0${'1'.repeat(config.lengths.SORT_KEY - 2)}`;
    expect(moveOps(it3(long, `${long}2`, 'a2'), 2, 1)).toEqual([patch('t0', 'a0'), patch('t2', 'a1'), patch('t1', 'a2')]);
  });

  it('własność: po przesunięciu klucze (z id) układają wiersze w nowej kolejności', () => {
    const keyArb = fc.oneof(fc.constant('a0'), fc.constant('a10'), fc.constantFrom('Zz', 'a1', 'a1V', 'a2', 'b00'));
    fc.assert(
      fc.property(fc.array(keyArb, { minLength: 1, maxLength: 12 }), fc.nat(), fc.nat(), (raw, f, g) => {
        // Kolejność z ekranu: klucz, potem id (jak taskOrder).
        const items = raw.map((sort_key, i) => ({ id: `t${String(i).padStart(2, '0')}`, sort_key })).sort(taskOrder);
        const from = f % items.length;
        const to = g % items.length;
        const want = [...items];
        want.splice(to, 0, want.splice(from, 1)[0]!);
        const next = new Map<string, string>(items.map((x) => [x.id, x.sort_key]));
        for (const op of moveOps(items, from, to) as unknown as { id: string; set: { sort_key: string } }[]) next.set(op.id, op.set.sort_key);
        const got = items.map((x) => ({ id: x.id, sort_key: next.get(x.id)! })).sort(taskOrder).map((x) => x.id);
        expect(got).toEqual(want.map((x) => x.id));
      }),
      { numRuns: 2000 },
    );
  });
});

describe('przeciąganie: granice i miejsce upuszczenia', () => {
  it('ten sam termin — ciągły fragment; bez terminu osobno', () => {
    const b = [dueBucket(null), dueBucket(null), dueBucket({ date: '2026-10-08', time: null }), dueBucket({ date: '2026-10-08', time: null }), dueBucket({ date: '2026-10-08', time: '17:00' })];
    expect(b).toEqual(['', '', '2026-10-08|', '2026-10-08|', '2026-10-08|17:00']);
    expect(moveRange(b, 0)).toEqual({ lo: 0, hi: 1 });
    expect(moveRange(b, 3)).toEqual({ lo: 2, hi: 3 });
    expect(moveRange(b, 4)).toEqual({ lo: 4, hi: 4 });
  });

  it('wiersz zajmuje miejsce sąsiada po minięciu połowy jego wysokości; nie wychodzi poza granice', () => {
    const h = [60, 60, 80, 60];
    expect(dropIndex(h, 1, 29, 0, 3)).toBe(1);
    expect(dropIndex(h, 1, 41, 0, 3)).toBe(2);
    expect(dropIndex(h, 1, 111, 0, 3)).toBe(3);
    expect(dropIndex(h, 1, 1000, 0, 2)).toBe(2);
    expect(dropIndex(h, 2, -31, 0, 3)).toBe(1);
    expect(dropIndex(h, 2, -91, 0, 3)).toBe(0);
    expect(dropIndex(h, 2, -1000, 1, 3)).toBe(1);
    expect(dropIndex(h, 2, 0, 0, 3)).toBe(2);
  });
});

describe('moveInList — klucze tylko w obrębie terminu', () => {
  const x = (id: string, sort_key: string, due: { date: string; time: string | null } | null = null) => ({ id, sort_key, due });
  it('fragment z tym samym terminem; poza nim albo poza listą — nic', () => {
    const items = [x('a', 'a0'), x('b', 'a0'), x('c', 'a0', { date: '2026-10-08', time: null }), x('d', 'a0', { date: '2026-10-08', time: null })];
    expect(moveInList(items, 1, 0)).toEqual([{ kind: 'patch', entity: 'tasks', id: 'b', set: { sort_key: 'Zz' } }]);
    expect(moveInList(items, 3, 2)).toEqual([{ kind: 'patch', entity: 'tasks', id: 'd', set: { sort_key: 'Zz' } }]);
    expect(moveInList(items, 1, 2)).toEqual([]);
    expect(moveInList(items, 2, 1)).toEqual([]);
    expect(moveInList(items, 9, 0)).toEqual([]);
  });
});
