import { splitId } from '../event-split';
import { applyOp, type NewOp, type Row } from '../sync-engine/client';
import { editEvent, eventDetail, fieldsOf } from '../views/events';
import { answerOps, RSVP_NAMESPACE, rsvpId, rsvpView, silencedForMe } from '../views/rsvp';

type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, id: string, row: Row) => ((t[e] ??= {})[id] = row);

function world(): T {
  const t: T = {};
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared' });
  put(t, 'groups', 'gp', { id: 'gp', name: 'Osobiste', kind: 'personal' });
  const m = (id: string, g: string, user: string | null, name: string, role: string, deleted: string | null = null) =>
    put(t, 'group_members', id, { member_id: id, group_id: g, user_id: user, display_name: name, role, deleted_at: deleted });
  m('me', 'gf', 'u1', 'Łukasz', 'admin');
  m('ala', 'gf', 'u2', 'Ala', 'owner');
  m('kuba', 'gf', null, 'Kuba', 'child');
  m('roza', 'gf', 'u3', 'Róża', 'child');
  m('stary', 'gf', 'u9', 'Stary', 'member', '2026-01-01');
  m('mp', 'gp', 'u1', 'Łukasz', 'owner');
  const ev = { group_id: 'gf', title: 'Basen', start_date: '2026-10-07', start_time: '17:00', end_time: null, rrule: null, audience: 'group', deleted_at: null };
  put(t, 'events', 'e1', { ...ev, id: 'e1' });
  put(t, 'events', 'e2', { ...ev, id: 'e2', audience: 'members' });
  put(t, 'events', 'ep', { ...ev, id: 'ep', group_id: 'gp' });
  put(t, 'events', 'ex', { ...ev, id: 'ex', deleted_at: '2026-10-01' });
  put(t, 'event_participants', 'p1', { id: 'p1', event_id: 'e2', member_id: 'kuba', deleted_at: null });
  put(t, 'event_participants', 'p2', { id: 'p2', event_id: 'e2', member_id: 'ala', deleted_at: '2026-10-01' });
  return t;
}
const apply = (t: T, ops: NewOp[]) => ops.forEach((o, i) => applyOp(t, { ...o, seq: i + 1, op_id: `o${i}` } as never));

describe('obecność (D124)', () => {
  it('identyfikator: UUIDv5 jak w Pythonie (uuid.uuid5)', () => {
    // python3 -c "import uuid; ns = uuid.uuid5(uuid.NAMESPACE_URL, 'https://github.com/lkarwowski494/organizer/event-rsvp'); print(ns, uuid.uuid5(ns, 'e1|2026-10-07|me'))"
    expect(RSVP_NAMESPACE).toBe('25e69e19-ed6c-5137-b6a6-d2fd2ff0a0e5');
    expect(rsvpId('e1', '2026-10-07', 'me')).toBe('7eb1533a-a34e-589a-b49f-f1c0d4f5386a');
  });

  it('cała grupa: ja pierwszy, potem za kogo odpowiadam, reszta po imieniu; usunięci pominięci', () => {
    const v = rsvpView(world(), 'u1', 'e1', '2026-10-07')!;
    expect(v.people.map((p) => [p.name, p.me, p.canAnswer])).toEqual([['Łukasz', true, true], ['Kuba', false, true], ['Ala', false, false], ['Róża', false, false]]);
    expect(v.counts).toEqual({ yes: 0, no: 0, maybe: 0, none: 4 });
    expect(v.groupId).toBe('gf');
  });

  it('odpowiedzi: utworzenie + przywrócenie + zmiana, potem sama zmiana; liczniki per termin', () => {
    const t = world();
    const first = answerOps(t, { groupId: 'gf', eventId: 'e1', date: '2026-10-07', memberId: 'kuba', answer: 'no' });
    expect(first.map((o) => o.kind)).toEqual(['create', 'restore', 'patch']);
    apply(t, first);
    apply(t, answerOps(t, { groupId: 'gf', eventId: 'e1', date: '2026-10-07', memberId: 'me', answer: 'yes' }));
    const again = answerOps(t, { groupId: 'gf', eventId: 'e1', date: '2026-10-07', memberId: 'kuba', answer: 'maybe' });
    expect(again).toEqual([{ kind: 'patch', entity: 'event_rsvps', id: rsvpId('e1', '2026-10-07', 'kuba'), set: { answer: 'maybe' } }]);
    apply(t, again);
    put(t, 'event_rsvps', 'zle', { id: 'zle', event_id: 'e1', occurrence_date: '2026-10-07', member_id: 'ala', answer: 'perhaps', deleted_at: null });
    put(t, 'event_rsvps', 'usun', { id: 'usun', event_id: 'e1', occurrence_date: '2026-10-07', member_id: 'roza', answer: 'yes', deleted_at: '2026-10-07' });
    const v = rsvpView(t, 'u1', 'e1', '2026-10-07')!;
    expect(v.people.map((p) => [p.name, p.answer])).toEqual([['Łukasz', 'yes'], ['Kuba', 'maybe'], ['Ala', null], ['Róża', null]]);
    expect(v.counts).toEqual({ yes: 1, no: 0, maybe: 1, none: 2 });
    expect(rsvpView(t, 'u1', 'e1', '2026-10-14')!.counts.none).toBe(4);
  });

  it('audyt 2 (E-25): odpowiedź na wiersz z kosza go przywraca; wiersz szukany po wydarzeniu, dniu i osobie', () => {
    const t = world();
    put(t, 'event_rsvps', 'stary', { id: 'stary', event_id: 'e1', occurrence_date: '2026-10-07', member_id: 'me', answer: 'no', deleted_at: '2026-10-07' });
    expect(answerOps(t, { groupId: 'gf', eventId: 'e1', date: '2026-10-07', memberId: 'me', answer: 'yes' })).toEqual([
      { kind: 'restore', entity: 'event_rsvps', id: 'stary' },
      { kind: 'patch', entity: 'event_rsvps', id: 'stary', set: { answer: 'yes' } },
    ]);
    // Żywy wiersz wygrywa z usuniętym o tym samym kluczu (np. stare dane po podziale serii z buildu 21).
    put(t, 'event_rsvps', 'nowy', { id: 'nowy', event_id: 'e1', occurrence_date: '2026-10-07', member_id: 'me', answer: 'maybe', deleted_at: null });
    expect(answerOps(t, { groupId: 'gf', eventId: 'e1', date: '2026-10-07', memberId: 'me', answer: 'yes' })).toEqual([{ kind: 'patch', entity: 'event_rsvps', id: 'nowy', set: { answer: 'yes' } }]);
  });

  it('wybrane osoby: tylko uczestnicy; dziecko z kontem odpowiada tylko za siebie', () => {
    expect(rsvpView(world(), 'u1', 'e2', '2026-10-07')!.people.map((p) => p.name)).toEqual(['Kuba']);
    const v = rsvpView(world(), 'u3', 'e1', '2026-10-07')!;
    expect(v.people.filter((p) => p.canAnswer).map((p) => p.name)).toEqual(['Róża']);
  });

  it('to samo imię: kolejność po identyfikatorze', () => {
    const t = world();
    put(t, 'group_members', 'ala0', { member_id: 'ala0', group_id: 'gf', user_id: 'u5', display_name: 'Ala', role: 'member', deleted_at: null });
    expect(rsvpView(t, 'u1', 'e1', '2026-10-07')!.people.map((p) => p.memberId)).toEqual(['me', 'kuba', 'ala', 'ala0', 'roza']);
  });

  it('audyt 2 (E-2): „to i następne” przenosi odpowiedzi od tego dnia — wszystkich osób — do nowej serii, z tym samym identyfikatorem', () => {
    const t = world();
    put(t, 'events', 'ew', { group_id: 'gf', title: 'Basen', start_date: '2026-10-07', start_time: '17:00', end_time: null, rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'group', deleted_at: null, id: 'ew' });
    apply(t, answerOps(t, { groupId: 'gf', eventId: 'ew', date: '2026-10-07', memberId: 'me', answer: 'yes' }));
    apply(t, answerOps(t, { groupId: 'gf', eventId: 'ew', date: '2026-10-14', memberId: 'kuba', answer: 'no' }));
    // Odpowiedź innego dorosłego (Ala odpowiada sama, z drugiego telefonu).
    put(t, 'event_rsvps', rsvpId('ew', '2026-10-21', 'ala'), { id: rsvpId('ew', '2026-10-21', 'ala'), group_id: 'gf', event_id: 'ew', occurrence_date: '2026-10-21', member_id: 'ala', answer: 'no', deleted_at: null });
    const d = eventDetail(t, 'u1', 'ew')!;
    apply(t, editEvent(d, '2026-10-14', 'following', fieldsOf(d, '2026-10-14', 'following')));
    const sid = splitId('ew', '2026-10-14');
    expect(t.event_rsvps![rsvpId('ew', '2026-10-07', 'me')]!.event_id).toBe('ew');
    expect(t.event_rsvps![rsvpId('ew', '2026-10-14', 'kuba')]!.event_id).toBe(sid);
    expect(rsvpView(t, 'u1', sid, '2026-10-21')!.people.find((p) => p.name === 'Ala')!.answer).toBe('no');
    // Odpowiedź na termin nowej serii trafia w ten sam (przeniesiony) wiersz.
    expect(answerOps(t, { groupId: 'gf', eventId: sid, date: '2026-10-14', memberId: 'kuba', answer: 'yes' })).toEqual([
      { kind: 'patch', entity: 'event_rsvps', id: rsvpId('ew', '2026-10-14', 'kuba'), set: { answer: 'yes' } },
    ]);
  });

  it('bez obecności: grupa osobista, wydarzenie usunięte albo nieznane, nie jestem w grupie', () => {
    const t = world();
    expect(rsvpView(t, 'u1', 'ep', '2026-10-07')).toBeNull();
    expect(rsvpView(t, 'u1', 'ex', '2026-10-07')).toBeNull();
    expect(rsvpView(t, 'u1', 'nope', '2026-10-07')).toBeNull();
    expect(rsvpView(t, 'obcy', 'e1', '2026-10-07')).toBeNull();
    // D126: lekcje z planu i rutyny bez obecności.
    for (const kind of ['lesson', 'routine']) {
      const w = world();
      put(w, 'events', 'e1', { ...w.events!.e1!, kind });
      expect(rsvpView(w, 'u1', 'e1', '2026-10-07')).toBeNull();
    }
    delete t.groups!.gf;
    expect(rsvpView(t, 'u1', 'e1', '2026-10-07')).toBeNull();
  });
});

describe('wyciszone terminy (PW-23, D160)', () => {
  const no = (t: T, member: string, extra: Row = {}) =>
    put(t, 'event_rsvps', `r-${member}`, { id: `r-${member}`, group_id: 'gf', event_id: 'e2', occurrence_date: '2026-10-07', member_id: member, answer: 'no', deleted_at: null, ...extra });

  it('dziecko jedynym uczestnikiem i „nie będzie” — wyciszone dla dorosłego; dla dziecka z kontem (rola child) — nie', () => {
    const t = world();
    no(t, 'kuba');
    expect([...silencedForMe(t, 'u1')]).toEqual(['e2|2026-10-07']);
    expect([...silencedForMe(t, 'u3')]).toEqual([]);
  });

  it('usunięty wyjątek z osobą odpowiedzialną nie liczy się; żywy — dotyczy jej wprost', () => {
    const t = world();
    no(t, 'kuba');
    put(t, 'event_overrides', 'o', { id: 'o', event_id: 'e2', occurrence_date: '2026-10-07', cancelled: false, responsible_member_id: 'me', deleted_at: '2026-10-06' });
    expect(silencedForMe(t, 'u1').size).toBe(1);
    t.event_overrides!.o = { ...t.event_overrides!.o!, deleted_at: null };
    expect(silencedForMe(t, 'u1').size).toBe(0);
  });

  it('bez tabeli wydarzeń — nic', () => {
    const t = world();
    no(t, 'kuba');
    delete t.events;
    expect(silencedForMe(t, 'u1').size).toBe(0);
  });
});
