import type { Row } from '../sync-engine/client';
import { recentShoppingList, shoppingItem } from '../views/quick-shopping';

describe('podpowiedź „Na listę zakupów”: cały wpis to jeden znany produkt (PW-3 D, M-24)', () => {
  it.each([
    ['mleko', 'mleko'],
    ['Mleko', 'Mleko'],
    ['2 mleka', '2 mleka'],
    ['chleb 2 szt.', 'chleb 2 szt.'],
    ['jajka x10', 'jajka x10'],
    ['mąka 1.5 kg', 'mąka 1.5 kg'],
    ['  pomidory  ', 'pomidory'],
    ['mąka  1.5   kg', 'mąka 1.5 kg'],
    ['ser', 'ser'],
    ['kiwi', 'kiwi'],
    ['banany 1 kg', 'banany 1 kg'],
    ['papier toaletowy', 'papier toaletowy'],
    ['nić dentystyczna', 'nić dentystyczna'],
    ['karma', 'karma'],
    ['baterie', 'baterie'],
  ])('„%s” → pozycja „%s”', (text, item) => {
    expect(shoppingItem(text)).toBe(item);
  });

  // Wpisy, które są zadaniami — żaden nie może dostać podpowiedzi (fałszywy alarm zabrałby zadanie z Moich spraw).
  it.each([
    'kupić mleko',
    'kupić mleko dla babci',
    'mleko dla babci',
    'karmić kota',
    'nakarmić psa',
    'wyprowadzić psa',
    'karmić',
    'mopować',
    'mopowanie',
    'karmienie',
    'pranie',
    'prasowanie',
    'gotowanie',
    'pakowanie',
    'spotkanie',
    'zakupy',
    'lista zakupów',
    'wynieść śmieci',
    'zapłacić rachunek za prąd',
    'rachunek za prąd',
    'dentysta',
    'wizyta u dentysty',
    'basen',
    'trening',
    'lekcje',
    'lekarz',
    'odebrać paczkę',
    'kawa z Anią',
    'pizza z dziećmi',
    'obiad u babci',
    'upiec chleb',
    'chleb upiec',
    'zrobić zupę',
    'ugotować makaron',
    'umyć okna',
    'naprawić kran',
    'urodziny Ali',
    'wymienić baterie w pilocie',
    'zadzwonić do mamy',
    'sprzątanie kuchni',
    'kot',
    'mleko 3,2%',
    'mleko3,2%',
    'mleko dla babci jutro',
    'ser żółty',
    '',
    '   ',
  ])('„%s” — bez podpowiedzi', (text) => {
    expect(shoppingItem(text)).toBeNull();
  });
});

describe('lista zakupów grupy, której ostatnio używano', () => {
  const ME = 'u-me';
  type T = { [e: string]: { [id: string]: Row } };
  const base = (): T => ({
    groups: { gf: { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-01-01T00:00:00Z', deleted_at: null }, gk: { id: 'gk', name: 'Klasa', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null } },
    group_members: { mf: { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null }, mk: { member_id: 'mk', group_id: 'gk', user_id: ME, display_name: 'Łukasz', role: 'member', deleted_at: null } },
    lists: {},
    tasks: {},
  });
  const list = (t: T, id: string, group: string, kind: string, version: number | undefined, extra: Row = {}) =>
    (t.lists![id] = { id, group_id: group, kind, name: id, visibility: 'group', sort_key: 'a0', deleted_at: null, ...(version === undefined ? {} : { version }), ...extra });
  const item = (t: T, id: string, listId: string, version?: number) => (t.tasks![id] = { id, list_id: listId, title: id, deleted_at: null, ...(version === undefined ? {} : { version }) });

  it('bez listy zakupów — brak; listy zadań i innych grup się nie liczą', () => {
    const t = base();
    list(t, 'lt', 'gf', 'tasks', 9);
    list(t, 'lk', 'gk', 'shopping', 9);
    expect(recentShoppingList(t, ME, 'gf')).toBeNull();
    expect(recentShoppingList(t, ME, 'gk')).toEqual({ id: 'lk', name: 'lk' });
  });

  it('kilka list: najnowsza wersja listy albo pozycji; niewysłana pozycja — najnowsza; remis — pierwsza; usunięta lista — nie', () => {
    const t = base();
    list(t, 'la', 'gf', 'shopping', 3);
    list(t, 'lb', 'gf', 'shopping', 5);
    expect(recentShoppingList(t, ME, 'gf')!.id).toBe('lb');
    item(t, 'mleko', 'la', 7);
    expect(recentShoppingList(t, ME, 'gf')!.id).toBe('la');
    item(t, 'chleb', 'lb');
    expect(recentShoppingList(t, ME, 'gf')!.id).toBe('lb');
    list(t, 'lc', 'gf', 'shopping', 99, { deleted_at: '2026-10-01T00:00:00Z' });
    expect(recentShoppingList(t, ME, 'gf')!.id).toBe('lb');
    const tie = base();
    list(tie, 'la', 'gf', 'shopping', 4);
    list(tie, 'lb', 'gf', 'shopping', 4);
    expect(recentShoppingList(tie, ME, 'gf')!.id).toBe('la');
    expect(recentShoppingList({}, ME, 'gf')).toBeNull();
  });
});
