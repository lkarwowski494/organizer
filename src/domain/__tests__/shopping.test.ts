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
import { applyOp, type Op } from '../sync-engine/client';
import { finishTripOps } from '../views/shopping-trip';

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
    // Audyt 2 (M-230): masło orzechowe to wyrób z orzeszków ziemnych, nie nabiał (źródła w src/config/shopping.pl.ts).
    ['Masło orzechowe', 'pantry'],
    ['2 słoiki masła orzechowego', 'pantry'],
    ['masło', 'dairy'],
    ['coś dziwnego', 'other'],
  ])('%s → %s', (name, cat) => expect(guessCategory(name)).toBe(cat));

  it('słownik: każdy wpis raz, klucze działów znane, „Inne” na końcu', () => {
    const all = Object.values(SHOPPING_KEYWORDS).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(SHOPPING_CATEGORIES.at(-1)!.key).toBe('other');
    expect(Object.keys(SHOPPING_KEYWORDS).sort()).toEqual(SHOPPING_CATEGORIES.map((c) => c.key).filter((k) => k !== 'other').sort());
    expect(categoryName('dairy')).toBe('Nabiał i jaja');
  });

  it('pamięć grupy: najnowszy ręczny wybór dla tej samej nazwy; inne grupy i listy zadań nie liczą się, usunięte — tak (M-110)', () => {
    const t = tables([
      { title: 'Mleko', category: 'pantry', version: 1 },
      { title: '2 mleko', category: 'drinks', version: 5, list_id: 'lz2' },
      { title: 'Mleko', category: 'baby', version: 9, list_id: 'lo' },
      { title: 'Mleko', category: 'meat', version: 10, list_id: 'lt' },
      { title: 'Mleko', category: 'sweets', version: 4, deleted_at: 'x' },
      { title: 'Chleb', category: 'nieznany', version: 3 },
      { title: 'Ser', category: 'pantry', version: 4 },
      { title: 'ser', category: 'dairy', version: 2 },
      { title: 'Woda', category: 'drinks', version: 6, deleted_at: 'x' },
    ]);
    expect([...categoryMemory(t, 'g')]).toEqual([['mleko', 'drinks'], ['ser', 'pantry'], ['woda', 'drinks']]);
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

  it('brakujące stałe i operacje ich dodania; w koszyku = już na liście (PWD-19 A); lista bez stałych albo nieznana', () => {
    const t = tables([{ title: '2 mleko' }, { title: 'Chleb', deleted_at: 'x' }, { title: 'Masło', list_id: 'lz2' }]);
    expect(staplesOf(t.lists.lz)).toEqual(['Mleko', 'Chleb']);
    expect(staplesOf({ staples: ['a', 3] })).toEqual(['a']);
    expect(staplesOf(undefined)).toEqual([]);
    expect(missingStaples(t, 'lz')).toEqual(['Chleb']);
    // R-20: „Mleko 2” w koszyku, stała „Mleko” — nie dubluje.
    expect(missingStaples(tables([{ title: 'Mleko 2', completed_at: 'x' }, { title: 'chleb' }]), 'lz')).toEqual([]);
    let n = 0;
    expect(addStaplesOps(t, 'lz', () => `n${++n}`)).toEqual([
      { kind: 'create', entity: 'tasks', id: 'n1', group_id: 'g', set: { list_id: 'lz', parent_id: null, title: 'Chleb', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } },
    ]);
    expect(addStaplesOps(t, 'brak', () => 'x')).toEqual([]);
    expect(missingStaples(t, 'lz2')).toEqual([]);
  });

  it('edycja stałych: dodanie, duplikat, puste, za długie, limit, usunięcie (polecenia serwera, M-111)', () => {
    const list = { id: 'lz', staples: ['Mleko'] };
    // Stała bez ilości (PWD-19 A).
    expect(addStaple(list, '  Jajka  x10 ')).toEqual({ ok: true, op: { kind: 'cmd', cmd: 'staple_add', args: { list_id: 'lz', name: 'Jajka' } } });
    expect(addStaple(list, '2 kg  jabłek')).toEqual({ ok: true, op: { kind: 'cmd', cmd: 'staple_add', args: { list_id: 'lz', name: 'jabłek' } } });
    expect(addStaple(list, '2 mleko')).toEqual({ ok: false, error: 'duplicate' });
    expect(addStaple(list, '   ')).toEqual({ ok: false, error: 'empty' });
    expect(addStaple(list, 'a'.repeat(201))).toEqual({ ok: false, error: 'tooLong' });
    expect(addStaple({ id: 'lz', staples: Array.from({ length: 50 }, (_, i) => `p${i}`) }, 'nowe')).toEqual({ ok: false, error: 'full' });
    expect(removeStaple(list, 'MLEKO')).toEqual({ kind: 'cmd', cmd: 'staple_remove', args: { list_id: 'lz', names: ['Mleko'] } });
    // Wszystkie stałe o tej samej nazwie (np. dopisane równocześnie z ilością i bez).
    expect(removeStaple({ id: 'lz', staples: ['Mleko', 'Chleb', 'mleko 2'] }, 'Mleko')).toEqual({ kind: 'cmd', cmd: 'staple_remove', args: { list_id: 'lz', names: ['Mleko', 'mleko 2'] } });
  });
});

describe('pamięć działów i podpowiedzi po zakupach (audyt 2, M-110)', () => {
  const act = (entityId: string, version: number, changes: R | null, extra: R = {}): R => ({ group_id: 'g', entity: 'tasks', entity_id: entityId, verb: 'update', changes, version, ...extra });

  it('R-9: „Zakupy zrobione” (kupione do kosza) nie kasuje pamięci działu ani podpowiedzi', () => {
    const t = tables([{ id: 'i1', title: 'Tofu', category: 'meat', completed_at: '2026-10-08T08:00:00Z' }]) as unknown as { [e: string]: { [id: string]: R } };
    expect(categoryMemory(t, 'g').get('tofu')).toBe('meat');
    expect(suggestions(t, 'g', 'lz', 'to')).toEqual(['Tofu']);
    let seq = 0;
    for (const op of finishTripOps(t, 'u-me', 'lz', false, '2026-10-08T09:00:00Z', () => 'trip-1')) applyOp(t, { ...op, seq: ++seq, op_id: `o${seq}` } as Op);
    expect(t.tasks!.i1!.deleted_at).not.toBeNull();
    expect(categoryMemory(t, 'g').get('tofu')).toBe('meat');
    expect(suggestions(t, 'g', 'lz', 'to')).toEqual(['Tofu']);
  });

  it('R-10: najnowszy wybór to chwila zmiany działu z historii, nie ostatnia zmiana wiersza', () => {
    const t = tables([
      { id: 'a', title: 'Tofu', category: 'dairy', version: 3 },
      { id: 'b', title: 'Tofu', category: 'meat', version: 5 },
    ]) as unknown as { [e: string]: { [id: string]: R } };
    t.activity = { x1: act('a', 3, { category: [null, 'dairy'] }), x2: act('b', 5, { category: [null, 'meat'] }) };
    expect(categoryMemory(t, 'g').get('tofu')).toBe('meat');
    // Odhaczenie starszej pozycji podbija wersję wiersza, ale nie zmienia działu.
    t.tasks!.a = { ...t.tasks!.a!, completed_at: '2026-10-08T10:00:00Z', version: 6 };
    t.activity.x3 = act('a', 6, { completed_at: [null, '2026-10-08T10:00:00Z'] });
    expect(categoryMemory(t, 'g').get('tofu')).toBe('meat');
    // Historia innej grupy, innej encji i wpisy bez zmian działu nie liczą się.
    t.activity.x4 = act('a', 9, { category: ['dairy', 'pets'] }, { group_id: 'h' });
    t.activity.x5 = act('a', 9, { category: ['dairy', 'pets'] }, { entity: 'lists' });
    t.activity.x6 = act('a', 9, null);
    t.activity.x7 = act('a', 9, { category: 'zly' });
    expect(categoryMemory(t, 'g').get('tofu')).toBe('meat');
    // Starszy wpis za nowszym (kolejność w tabeli dowolna) nie przesłania nowszego.
    t.activity.x8 = act('b', 1, { category: [null, 'pantry'] });
    expect(categoryMemory(t, 'g').get('tofu')).toBe('meat');
    // Wybór z tego telefonu, którego historia jeszcze nie zna (przed wysłaniem), jest najnowszy.
    t.tasks!.a = { ...t.tasks!.a!, category: 'pantry' };
    expect(categoryMemory(t, 'g').get('tofu')).toBe('pantry');
    // Potwierdzony przez serwer (wpis historii) — już jako wybór z chwilą zmiany.
    t.activity.x9 = act('a', 7, { category: ['dairy', 'pantry'] });
    expect(categoryMemory(t, 'g').get('tofu')).toBe('pantry');
    t.activity.x10 = act('b', 8, { category: ['meat', 'frozen'] });
    t.tasks!.b = { ...t.tasks!.b!, category: 'frozen', version: 8 };
    expect(categoryMemory(t, 'g').get('tofu')).toBe('frozen');
  });

  it('M-62: wybór sprzed zachowanej historii (wpis usunęła retencja) nie wygrywa z nowszym wyborem z historii', () => {
    const t = tables([
      { id: 'a', title: 'Tofu', category: 'dairy', version: 2 },
      { id: 'b', title: 'Tofu', category: 'meat', version: 5 },
    ]) as unknown as { [e: string]: { [id: string]: R } };
    // Historia zaczyna się od wersji 4: wybór dla „a” (wersja 2) już z niej zniknął.
    t.activity = { x1: act('b', 5, { category: [null, 'meat'] }), x2: act('q', 4, { title: [null, 'X'] }) };
    expect(categoryMemory(t, 'g').get('tofu')).toBe('meat');
    // Pozycja nowsza niż początek historii, a bez wpisu działu — zmiana z tego telefonu przed wysłaniem: najnowsza.
    t.tasks!.c = { id: 'c', list_id: 'lz', title: 'Tofu', category: 'frozen', version: 6, deleted_at: null, completed_at: null };
    expect(categoryMemory(t, 'g').get('tofu')).toBe('frozen');
    // Dwa wybory bez wpisu w historii (oba z tego telefonu) — remis rozstrzyga wyższa wersja wiersza, w dowolnej kolejności.
    t.tasks!.d = { id: 'd', list_id: 'lz', title: 'Tofu', category: 'pets', version: 5, deleted_at: null, completed_at: null };
    expect(categoryMemory(t, 'g').get('tofu')).toBe('frozen');
  });
});
