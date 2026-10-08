import type { Row } from '../sync-engine/client';
import { extractTag, quickGroups, resolveListQuick, resolveQuick, tagTargets, unseenInMyDays, withoutShortcuts } from '../views/quick-target';

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);

/** Osobista, „Rodzina” (ja admin; Ala, Kuba-dziecko), „Klasa 2b” (ja; Alicja), „Babcia” (ja dzieckiem; Ala). */
function base(): T {
  const t: T = {};
  const g = (id: string, name: string, kind: string, created: string) => put(t, 'groups', id, { id, name, kind, created_at: created, deleted_at: null });
  g(ME, 'Osobiste', 'personal', '2026-01-01T00:00:00Z');
  g('gf', 'Rodzina', 'shared', '2026-02-01T00:00:00Z');
  g('gk', 'Klasa 2b', 'shared', '2026-03-01T00:00:00Z');
  g('gc', 'Babcia', 'shared', '2026-04-01T00:00:00Z');
  const m = (id: string, gid: string, user: string | null, name: string, role = 'member') =>
    put(t, 'group_members', id, { member_id: id, group_id: gid, user_id: user, display_name: name, role, deleted_at: null });
  m(ME, ME, ME, 'Łukasz', 'owner');
  m('mf', 'gf', ME, 'Łukasz', 'admin');
  m('ala', 'gf', 'u-ala', 'Ala', 'owner');
  m('kuba', 'gf', null, 'Kuba', 'child');
  m('mk', 'gk', ME, 'Łukasz');
  m('alicja', 'gk', 'u-al', 'Alicja');
  m('jan', 'gk', 'u-jan', 'Jan');
  m('mc', 'gc', ME, 'Łukasz', 'child');
  m('ala3', 'gc', 'u-ala3', 'Ala');
  return t;
}
const LABEL = 'Osobiste';
const r = (text: string, chipGroupId: string | null = null, answers = {}) => resolveQuick(base(), ME, text, { chipGroupId, personalLabel: LABEL, answers });
const ok = (text: string, chip: string | null = null, answers = {}) => {
  const x = r(text, chip, answers);
  if (x.kind !== 'ok') throw new Error(`nie ok: ${x.kind}`);
  return x.target;
};

describe('„#grupa” (audyt 2, M-24)', () => {
  it('pierwsze „#słowo”; „#” wewnątrz słowa albo samo — nie', () => {
    expect(extractTag('basen #Rodzina jutro #Klasa')).toEqual({ start: 6, end: 14, name: 'Rodzina' });
    expect(extractTag('#klasa2b zebranie')).toEqual({ start: 0, end: 8, name: 'klasa2b' });
    expect(extractTag('kurs C# i # sam')).toBeNull();
  });

  it('dopasowanie: początek nazwy bez wielkości liter, polskich znaków i spacji; dokładna nazwa wygrywa', () => {
    const groups = [{ id: 'a', name: 'Rodzina' }, { id: 'b', name: 'Rodzina Ali' }, { id: 'c', name: 'Klasa 2b' }, { id: 'd', name: 'Łódź' }];
    expect(tagTargets(groups, 'rodzina').map((g) => g.id)).toEqual(['a']);
    expect(tagTargets(groups, 'rodz').map((g) => g.id)).toEqual(['a', 'b']);
    expect(tagTargets(groups, 'KLASA2B').map((g) => g.id)).toEqual(['c']);
    expect(tagTargets(groups, 'lodz').map((g) => g.id)).toEqual(['d']);
    expect(tagTargets(groups, 'x')).toEqual([]);
  });

  it('grupy do wyboru: bez tych, gdzie jestem dzieckiem; osobista pod nazwą z ekranu albo z bazy', () => {
    expect(quickGroups(base(), ME, 'Moje').map((g) => [g.id, g.name, g.shared, g.meId])).toEqual([
      [ME, 'Moje', false, ME],
      ['gf', 'Rodzina', true, 'mf'],
      ['gk', 'Klasa 2b', true, 'mk'],
    ]);
    expect(quickGroups(base(), ME)[0]!.name).toBe('Osobiste');
  });

  it('„#Rodzina” wybiera grupę i znika z nazwy; „#Osobiste” — osobista', () => {
    expect(ok('basen #Rodzina jutro')).toEqual({ groupId: 'gf', memberId: null, body: 'basen          jutro', from: 'tag' });
    expect(ok('#osob basen', 'gf')).toMatchObject({ groupId: ME, from: 'tag' });
  });

  it('kilka grup — pytanie, odpowiedź wybiera; żadna — pytanie z grupą chipa, potem „#…” zostaje w nazwie', () => {
    const t = base();
    put(t, 'groups', 'gr', { id: 'gr', name: 'Rodzice', kind: 'shared', created_at: '2026-05-01T00:00:00Z', deleted_at: null });
    put(t, 'group_members', 'mr', { member_id: 'mr', group_id: 'gr', user_id: ME, display_name: 'Łukasz', role: 'member', deleted_at: null });
    expect(resolveQuick(t, ME, 'zebranie #rodz', { chipGroupId: null })).toEqual({ kind: 'manyGroups', name: 'rodz', groups: [{ id: 'gf', name: 'Rodzina' }, { id: 'gr', name: 'Rodzice' }] });
    expect(resolveQuick(t, ME, 'zebranie #rodz', { chipGroupId: null, answers: { group: 'gr' } })).toMatchObject({ kind: 'ok', target: { groupId: 'gr', from: 'tag' } });
    expect(r('bilety #kino', 'gk')).toEqual({ kind: 'unknownGroup', name: 'kino', chip: { id: 'gk', name: 'Klasa 2b' } });
    expect(ok('bilety #kino', 'gk', { skipTag: true })).toEqual({ groupId: 'gk', memberId: null, body: 'bilety #kino', from: 'chip' });
    // Grupa, w której jestem dzieckiem, nie jest do wyboru.
    expect(r('ciasto #babcia').kind).toBe('unknownGroup');
  });
});

describe('„@ja” i „@imię” z grupą wpisu (audyt 2, M-24)', () => {
  it('„@ja” we wspólnej grupie — ja; w osobistej — bez osoby; ma pierwszeństwo przed „Jan”', () => {
    expect(ok('basen @ja', 'gf')).toEqual({ groupId: 'gf', memberId: 'mf', body: 'basen    ', from: 'chip' });
    expect(ok('basen @JA #Klasa')).toMatchObject({ groupId: 'gk', memberId: 'mk', from: 'tag' });
    expect(ok('basen @ja')).toMatchObject({ groupId: ME, memberId: null });
    expect(ok('zebranie @jan', 'gk')).toMatchObject({ groupId: 'gk', memberId: 'jan' });
  });

  it('osoba z grupy chipa ma pierwszeństwo; bez niej — wszystkie grupy (D91), grupa z osoby', () => {
    expect(ok('zebranie @al', 'gk')).toEqual({ groupId: 'gk', memberId: 'alicja', body: 'zebranie    ', from: 'chip' });
    expect(ok('basen @ala')).toMatchObject({ groupId: 'gf', memberId: 'ala', from: 'mention' });
    expect(r('zebranie @al')).toMatchObject({ kind: 'many', name: 'al', targets: [{ memberId: 'ala' }, { memberId: 'alicja' }] });
    expect(ok('zebranie @al', null, { person: { groupId: 'gk', groupName: 'Klasa 2b', memberId: 'alicja', displayName: 'Alicja' } })).toMatchObject({ groupId: 'gk', memberId: 'alicja', from: 'mention' });
  });

  it('po „#” tylko osoby z tej grupy; nikogo — pytanie, potem „@…” zostaje w nazwie', () => {
    expect(r('basen #Klasa @ala')).toEqual({ kind: 'unknown', name: 'ala' });
    expect(ok('basen #Klasa @ala', null, { skipMention: true })).toEqual({ groupId: 'gk', memberId: null, body: 'basen        @ala', from: 'tag' });
    expect(r('bilety @Zosia', 'gf')).toEqual({ kind: 'unknown', name: 'Zosia' });
    expect(ok('bilety @Zosia', 'gf', { skipMention: true })).toEqual({ groupId: 'gf', memberId: null, body: 'bilety @Zosia', from: 'chip' });
  });

  it('chip spoza moich grup — osobista; bez żadnej grupy — brak', () => {
    expect(ok('basen', 'gc')).toEqual({ groupId: ME, memberId: null, body: 'basen', from: 'chip' });
    expect(ok('basen', 'nie-ma')).toMatchObject({ groupId: ME });
    expect(resolveQuick({}, ME, 'basen', { chipGroupId: null })).toEqual({ kind: 'noGroup' });
  });

  it('tekst bez skrótów — czy zostaje nazwa (M-168)', () => {
    expect(withoutShortcuts('#Rodzina @ja')).toBe(' '.repeat(12));
    expect(withoutShortcuts('jutro @al')).toBe('jutro    ');
    expect(withoutShortcuts('basen')).toBe('basen');
  });
});

describe('nikt nie zobaczy w Moich sprawach (D68 po PW-18 b)', () => {
  it('wspólna grupa bez osoby i terminu — tak; z osobą, terminem albo w osobistej — nie', () => {
    const t = base();
    expect(unseenInMyDays(t, ME, { groupId: 'gf', memberId: null }, false)).toBe(true);
    expect(unseenInMyDays(t, ME, { groupId: 'gf', memberId: null }, true)).toBe(false);
    expect(unseenInMyDays(t, ME, { groupId: 'gf', memberId: 'ala' }, false)).toBe(false);
    expect(unseenInMyDays(t, ME, { groupId: ME, memberId: null }, false)).toBe(false);
    expect(unseenInMyDays(t, ME, { groupId: 'nie-ma', memberId: null }, false)).toBe(false);
  });
});

describe('pole dodawania na liście zadań: „@imię” i „@ja” (spójnie z Moimi sprawami)', () => {
  const lists = () => {
    const t = base();
    const l = (id: string, gid: string, visibility = 'group', owner: string | null = null) => put(t, 'lists', id, { id, group_id: gid, kind: 'tasks', name: id, visibility, owner_member_id: owner, sort_key: 'a0', deleted_at: null });
    l('lf', 'gf');
    l('lprv', 'gf', 'private', 'mf');
    l('lp', ME);
    l('lc', 'gc');
    put(t, 'group_members', 'alek', { member_id: 'alek', group_id: 'gf', user_id: 'u-alek', display_name: 'Alek', role: 'member', deleted_at: null });
    return t;
  };
  const q = (listId: string, text: string, answers = {}) => resolveListQuick(lists(), ME, listId, text, answers);

  it('osoba z grupy listy, która ją widzi; „@” znika z nazwy (spacjami, jak w Moich sprawach)', () => {
    expect(q('lf', 'basen @Kuba jutro')).toEqual({ kind: 'ok', memberId: 'kuba', body: 'basen       jutro' });
    // Alicja z innej grupy (Klasa 2b) się nie liczy — tylko grupa listy.
    expect(q('lf', 'zebranie @al')).toEqual({ kind: 'many', name: 'al', targets: [expect.objectContaining({ memberId: 'ala' }), expect.objectContaining({ memberId: 'alek' })] });
    expect(q('lf', 'zebranie @al', { person: { groupId: 'gf', groupName: 'Rodzina', memberId: 'alek', displayName: 'Alek' } })).toMatchObject({ kind: 'ok', memberId: 'alek' });
    // Lista „Tylko ja”: nikt inny jej nie widzi.
    expect(q('lprv', 'prezent @ala')).toEqual({ kind: 'unknown', name: 'ala' });
    expect(q('lf', 'basen @Zosia')).toEqual({ kind: 'unknown', name: 'Zosia' });
    expect(q('lf', 'basen @Zosia', { skipMention: true })).toEqual({ kind: 'ok', memberId: null, body: 'basen @Zosia' });
  });

  it('„@ja” — ja we wspólnej grupie, w osobistej bez osoby; bez „@” i „#” — tekst bez zmian', () => {
    expect(q('lf', 'basen @ja')).toEqual({ kind: 'ok', memberId: 'mf', body: 'basen    ' });
    expect(q('lp', 'basen @ja')).toEqual({ kind: 'ok', memberId: null, body: 'basen    ' });
    expect(q('lf', 'basen #Klasa')).toEqual({ kind: 'ok', memberId: null, body: 'basen #Klasa' });
    expect(resolveListQuick(lists(), ME, 'lf', 'basen')).toEqual({ kind: 'ok', memberId: null, body: 'basen' });
  });

  it('lista, na której jestem dzieckiem, albo nieznana — „@” zostaje w nazwie', () => {
    expect(q('lc', 'basen @ala')).toEqual({ kind: 'ok', memberId: null, body: 'basen @ala' });
    expect(q('brak', 'basen @ala')).toEqual({ kind: 'ok', memberId: null, body: 'basen @ala' });
  });
});
