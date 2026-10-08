import { SHOPPING_CATEGORIES, SHOPPING_KEYWORDS } from '../../config/shopping.pl';
import {
  addStaplesOps,
  categoryMemory,
  categoryName,
  categoryOf,
  addStaple,
  guessCategory,
  itemKey,
  missingStaples,
  removeStaple,
  sections,
  setCategory,
  staplesOf,
  suggestions,
} from '../views/shopping';

type R = { [k: string]: unknown };
function tables(items: R[], lists: R[] = []) {
  const t: { lists: { [id: string]: R }; tasks: { [id: string]: R } } = { lists: {}, tasks: {} };
  for (const l of [{ id: 'lz', group_id: 'g', kind: 'shopping', deleted_at: null, staples: ['Mleko', 'Chleb'] }, { id: 'lz2', group_id: 'g', kind: 'shopping', deleted_at: null }, { id: 'lt', group_id: 'g', kind: 'tasks', deleted_at: null }, { id: 'lo', group_id: 'h', kind: 'shopping', deleted_at: null }, ...lists]) t.lists[String(l.id)] = l;
  items.forEach((x, i) => (t.tasks[String(x.id ?? `t${i}`)] = { id: `t${i}`, list_id: 'lz', deleted_at: null, completed_at: null, version: i + 1, ...x }));
  return t;
}

describe('działy zakupów (D85)', () => {
  it('nazwa do porównań bez ilości, małymi literami', () => {
    expect(itemKey('  2 kg  Jabłek ')).toBe('jabłek');
    expect(itemKey('Mleko  3,2%')).toBe('mleko 3,2%');
  });

  it.each([
    ['2 kg jabłek', 'produce'],
    ['Jabłka', 'produce'],
    ['chleb żytni', 'bakery'],
    ['ser żółty', 'dairy'],
    ['serwetki', 'household'],
    ['żelki Haribo', 'sweets'],
    ['żel pod prysznic', 'hygiene'],
    ['papier toaletowy x8', 'hygiene'],
    ['mleko modyfikowane', 'baby'],
    ['mleko', 'dairy'],
    ['pierś z kurczaka', 'meat'],
    ['woda 6', 'drinks'],
    ['kostki lodu', 'frozen'],
    ['karma dla kota', 'pets'],
    ['pomidory w puszce', 'pantry'],
    ['coś dziwnego', 'other'],
  ])('%s → %s', (name, cat) => expect(guessCategory(name)).toBe(cat));

  it('słownik: każdy wpis raz, klucze działów znane, „Inne” na końcu', () => {
    const all = Object.values(SHOPPING_KEYWORDS).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(SHOPPING_CATEGORIES.at(-1)!.key).toBe('other');
    expect(Object.keys(SHOPPING_KEYWORDS).sort()).toEqual(SHOPPING_CATEGORIES.map((c) => c.key).filter((k) => k !== 'other').sort());
    expect(categoryName('dairy')).toBe('Nabiał i jaja');
  });

  it('pamięć grupy: najnowszy ręczny wybór dla tej samej nazwy; inne grupy, listy zadań i usunięte nie liczą się', () => {
    const t = tables([
      { title: 'Mleko', category: 'pantry', version: 1 },
      { title: '2 mleko', category: 'drinks', version: 5, list_id: 'lz2' },
      { title: 'Mleko', category: 'baby', version: 9, list_id: 'lo' },
      { title: 'Mleko', category: 'meat', version: 10, list_id: 'lt' },
      { title: 'Mleko', category: 'sweets', version: 11, deleted_at: 'x' },
      { title: 'Chleb', category: 'nieznany', version: 3 },
      { title: 'Ser', category: 'pantry', version: 4 },
      { title: 'ser', category: 'dairy', version: 2 },
    ]);
    expect([...categoryMemory(t, 'g')]).toEqual([['mleko', 'drinks'], ['ser', 'pantry']]);
    const memory = categoryMemory(t, 'g');
    expect(categoryOf({ title: 'MLEKO' }, memory)).toBe('drinks');
    expect(categoryOf({ title: 'Mleko', category: 'frozen' }, memory)).toBe('frozen');
    expect(categoryOf({ title: 'Chleb' }, memory)).toBe('bakery');
    expect(categoryOf({}, memory)).toBe('other');
    expect(categoryMemory({}, 'g').size).toBe(0);
    // Wiersz bez tytułu i wersji (niepełne dane) nie psuje pamięci.
    expect([...categoryMemory(tables([{ category: 'dairy', title: undefined, version: undefined }]), 'g')]).toEqual([['', 'dairy']]);
  });

  it('sekcje w kolejności działów, puste pominięte, kolejność w dziale zachowana', () => {
    const t = tables([
      { id: 'a', title: 'Mydło' },
      { id: 'b', title: 'Banany' },
      { id: 'c', title: 'Gruszki' },
      { id: 'd', title: 'XYZ' },
    ]);
    const s = sections([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'zz' }], t, 'g');
    expect(s.map((x) => [x.key, x.name, x.items.map((i) => i.id)])).toEqual([
      ['produce', 'Owoce i warzywa', ['b', 'c']],
      ['hygiene', 'Higiena i kosmetyki', ['a']],
      ['other', 'Inne', ['d', 'zz']],
    ]);
    expect(sections([], {}, 'g')).toEqual([]);
    expect(setCategory('a', 'dairy')).toEqual({ kind: 'patch', entity: 'tasks', id: 'a', set: { category: 'dairy' } });
  });
});

describe('podpowiedzi i stałe zakupy (D86)', () => {
  it('najczęstsze w grupie, od wpisanego początku, bez czekających i bez identycznej nazwy', () => {
    const t = tables([
      { title: 'Masło', completed_at: 'x' },
      { title: 'masło 2', completed_at: 'x', version: 50 },
      { title: 'Marchew', completed_at: 'x' },
      { title: 'Makaron', list_id: 'lz2' },
      { title: 'Majonez', completed_at: 'x', list_id: 'lo' },
      { title: 'Mąka', deleted_at: 'x' },
      { title: 'Mango', completed_at: 'x', list_id: 'lt' },
      { title: 'Ma' },
    ]);
    expect(suggestions(t, 'g', 'lz', ' MA')).toEqual(['masło', 'Makaron', 'Marchew']);
    expect(suggestions(t, 'g', 'lz2', 'ma')).toEqual(['masło', 'Marchew']);
    expect(suggestions(t, 'g', 'lz', 'm')).toEqual([]);
    expect(suggestions(t, 'g', 'lz', 'masło')).toEqual([]);
    expect(suggestions({}, 'g', 'lz', 'ma')).toEqual([]);
  });

  it('najwyżej tyle podpowiedzi, ile w konfiguracji; remis — alfabetycznie; nazwa z najnowszego wpisu', () => {
    const t = tables(['Ba1', 'Ba2', 'Ba3', 'Ba4', 'Ba5', 'Ba6'].map((title): R => ({ title, completed_at: 'x' })).concat([{ title: 'BA6', completed_at: 'x', version: 0 }]));
    expect(suggestions(t, 'g', 'lz', 'ba')).toEqual(['Ba6', 'Ba1', 'Ba2', 'Ba3', 'Ba4']);
  });

  it('brakujące stałe i operacje ich dodania; lista bez stałych albo nieznana', () => {
    const t = tables([{ title: '2 mleko' }, { title: 'Chleb', completed_at: 'x' }]);
    expect(staplesOf(t.lists.lz)).toEqual(['Mleko', 'Chleb']);
    expect(staplesOf({ staples: ['a', 3] })).toEqual(['a']);
    expect(staplesOf(undefined)).toEqual([]);
    expect(missingStaples(t, 'lz')).toEqual(['Chleb']);
    let n = 0;
    expect(addStaplesOps(t, 'lz', () => `n${++n}`)).toEqual([
      { kind: 'create', entity: 'tasks', id: 'n1', group_id: 'g', set: { list_id: 'lz', parent_id: null, title: 'Chleb', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } },
    ]);
    expect(addStaplesOps(t, 'brak', () => 'x')).toEqual([]);
    expect(missingStaples(t, 'lz2')).toEqual([]);
  });

  it('edycja stałych: dodanie, duplikat, puste, za długie, limit, usunięcie', () => {
    const list = { id: 'lz', staples: ['Mleko'] };
    expect(addStaple(list, '  Jajka  x10 ')).toEqual({ ok: true, op: { kind: 'patch', entity: 'lists', id: 'lz', set: { staples: ['Mleko', 'Jajka x10'] } } });
    expect(addStaple(list, '2 mleko')).toEqual({ ok: false, error: 'duplicate' });
    expect(addStaple(list, '   ')).toEqual({ ok: false, error: 'empty' });
    expect(addStaple(list, 'a'.repeat(201))).toEqual({ ok: false, error: 'tooLong' });
    expect(addStaple({ id: 'lz', staples: Array.from({ length: 50 }, (_, i) => `p${i}`) }, 'nowe')).toEqual({ ok: false, error: 'full' });
    expect(removeStaple(list, 'MLEKO')).toEqual({ kind: 'patch', entity: 'lists', id: 'lz', set: { staples: [] } });
  });
});
