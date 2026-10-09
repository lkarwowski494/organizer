import type { Row } from '../sync-engine/client';
import { extractMention, foldName, mentionTargets } from '../views/mention';

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);

function base(): T {
  const t: T = {};
  const g = (id: string, name: string, kind: string, created: string) => put(t, 'groups', id, { id, name, kind, created_at: created, deleted_at: null });
  g(ME, 'Osobiste', 'personal', '2026-01-01T00:00:00Z');
  g('gf', 'Rodzina', 'shared', '2026-02-01T00:00:00Z');
  g('gk', 'Klasa 2b', 'shared', '2026-03-01T00:00:00Z');
  g('gc', 'Babcia', 'shared', '2026-04-01T00:00:00Z');
  const m = (id: string, gid: string, user: string | null, name: string, role = 'member', deleted: string | null = null) =>
    put(t, 'group_members', id, { member_id: id, group_id: gid, user_id: user, display_name: name, role, deleted_at: deleted });
  m(ME, ME, ME, 'Łukasz', 'owner');
  m('mf', 'gf', ME, 'Łukasz', 'admin');
  m('ala', 'gf', 'u-ala', 'Ala', 'owner');
  m('tymek', 'gf', null, 'Tymek', 'child');
  m('ania', 'gf', 'u-ania', 'Ania', 'member', '2026-05-01T00:00:00Z');
  m('mk', 'gk', ME, 'Łukasz');
  m('ala2', 'gk', 'u-ala2', 'Alicja Nowak');
  m('lucja', 'gk', 'u-l', 'Łucja');
  m('mc', 'gc', ME, 'Łukasz', 'child');
  m('ala3', 'gc', 'u-ala3', 'Ala');
  return t;
}

describe('@imię w szybkim dodawaniu (D91)', () => {
  it('wyciąga pierwsze @słowo i zostawia resztę tekstu', () => {
    expect(extractMention('basen jutro 19.00 @Ala')).toEqual({ text: 'basen jutro 19.00', mention: { start: 18, end: 22, name: 'Ala' } });
    expect(extractMention('@Tymek trening w piątek @Ala')).toEqual({ text: 'trening w piątek @Ala', mention: { start: 0, end: 6, name: 'Tymek' } });
    expect(extractMention('mail ala@x.pl')).toEqual({ text: 'mail ala@x.pl', mention: null });
    expect(extractMention('sam @ znak')).toEqual({ text: 'sam @ znak', mention: null });
  });

  it('dopasowanie po początku imienia, bez wielkości liter i polskich znaków; bez mnie, usuniętych i grup, gdzie jestem dzieckiem', () => {
    const t = base();
    expect(mentionTargets(t, ME, 'ALA').map((x) => `${x.displayName}@${x.groupName}`)).toEqual(['Ala@Rodzina']);
    expect(mentionTargets(t, ME, 'al').map((x) => `${x.displayName}@${x.groupName}`)).toEqual(['Ala@Rodzina', 'Alicja Nowak@Klasa 2b']);
    expect(mentionTargets(t, ME, 'tym')).toEqual([{ groupId: 'gf', groupName: 'Rodzina', memberId: 'tymek', displayName: 'Tymek' }]);
    expect(mentionTargets(t, ME, 'lucja').map((x) => x.memberId)).toEqual(['lucja']);
    expect(mentionTargets(t, ME, 'Łuk')).toEqual([]);
    expect(mentionTargets(t, ME, 'ania')).toEqual([]);
    expect(mentionTargets(t, ME, '')).toEqual([]);
    expect(mentionTargets({}, ME, 'ala')).toEqual([]);
  });

  it('odmiana: „@Alą” pasuje do „Ala” (ą → a przy porównaniu bez polskich znaków), „@Alę” już nie (ADR 0019)', () => {
    const t = base();
    expect(mentionTargets(t, ME, 'Alą').map((x) => x.memberId)).toEqual(['ala']);
    expect(mentionTargets(t, ME, 'Alę')).toEqual([]);
  });

  it('członek bez imienia nie psuje dopasowania', () => {
    const t = base();
    put(t, 'group_members', 'x', { member_id: 'x', group_id: 'gf', user_id: 'u-x', display_name: undefined, role: 'member', deleted_at: null });
    expect(mentionTargets(t, ME, 'a').map((x) => x.memberId)).toEqual(['ala', 'ala2']);
    expect(mentionTargets(t, ME, 'x')).toEqual([]);
  });
});

describe('porównanie imion i nazw', () => {
  it('bez wielkości liter i polskich znaków', () => {
    expect(foldName('Łucja ŻÓŁTA')).toBe('lucja zolta');
  });
});
