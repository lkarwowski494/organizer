/**
 * „To i następne” jako jedno polecenie (audyt 2, M-3): lokalny skutek polecenia split_event (ten sam algorytm co
 * private.split_event; zgodność z SQL sprawdza tests/db/event-split.test.ts).
 */
import { applySplit, capUntil, ruleUntil, splitId, SPLIT_NAMESPACE, type SplitArgs } from '../event-split';
import { applyOp, type Op, type Row } from '../sync-engine/client';

type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, id: string, row: Row) => ((t[e] ??= {})[id] = row);

/** Rodzina: ja (dorosły), Ala (dorosła), Tymek (dziecko), Ola (usunięta z grupy); chór w poniedziałki od 5.10. */
function world(): T {
  const t: T = {};
  const m = (id: string, role: string, deleted: string | null = null) => put(t, 'group_members', id, { member_id: id, group_id: 'gf', user_id: null, display_name: id, role, deleted_at: deleted });
  m('me', 'admin');
  m('ala', 'member');
  m('tymek', 'child');
  m('ola', 'member', '2026-10-01T00:00:00Z');
  put(t, 'group_members', 'obcy', { member_id: 'obcy', group_id: 'gx', role: 'member', deleted_at: null });
  put(t, 'events', 'chor', { id: 'chor', group_id: 'gf', title: 'Chór', note: 'Nuty w teczce', start_date: '2026-10-05', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', responsible_member_id: 'me', location: null, kind: 'lesson', split_from: null, deleted_at: null });
  return t;
}
const set = (over: Partial<SplitArgs['set']> = {}): SplitArgs['set'] => ({ title: 'Chór', start_date: '2026-10-19', start_time: '18:00', end_time: '19:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', responsible_member_id: 'me', location: null, ...over });
const args = (over: Partial<SplitArgs> = {}): SplitArgs => ({ id: splitId('chor', '2026-10-19'), event_id: 'chor', date: '2026-10-19', set: set(), participants: [], drop_overrides: [], tasks: [], ...over });
const split = (t: T, a: SplitArgs) => (applySplit(t, a as unknown as Row), t);
const S = splitId('chor', '2026-10-19');

describe('reguła: koniec serii tekstowo (jak w SQL)', () => {
  it('ruleUntil i capUntil', () => {
    expect(ruleUntil(null)).toBeNull();
    expect(ruleUntil('FREQ=WEEKLY;BYDAY=MO')).toBeNull();
    expect(ruleUntil('FREQ=WEEKLY;UNTIL=20261018;BYDAY=MO')).toBe('2026-10-18');
    expect(ruleUntil('FREQ=DAILY;UNTIL=20261018T000000Z')).toBeNull(); // nie ten zapis (telefon go nie tworzy)
    expect(capUntil(null, '2026-10-18')).toBeNull();
    expect(capUntil('FREQ=DAILY', null)).toBe('FREQ=DAILY');
    expect(capUntil('FREQ=WEEKLY;COUNT=5;BYDAY=MO', '2026-10-18')).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261018');
    expect(capUntil('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231', '2026-10-18')).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261018');
    // Wcześniejszy koniec zostaje (podział nie wydłuża serii).
    expect(capUntil('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261001', '2026-10-18')).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261001');
  });

  it('identyfikator nowej serii: UUIDv5 jak w Pythonie (uuid.uuid5)', () => {
    // python3 -c "import uuid; ns = uuid.uuid5(uuid.NAMESPACE_URL, 'https://github.com/lkarwowski494/organizer/event-split'); print(ns, uuid.uuid5(ns, 'e1|2026-10-14'))"
    expect(SPLIT_NAMESPACE).toBe('b17d6bd4-aff3-54f2-9b38-d323a09670df');
    expect(splitId('e1', '2026-10-14')).toBe('e04f7faa-430c-502b-bb40-8d88c0d20c65');
  });
});

describe('podział serii na telefonie (applySplit)', () => {
  it('D199: długość całodniowej — z polecenia, bez niej jak w dzielonej (i w powtórzonym), z godziną 1 (jak SQL)', () => {
    const camp = () => {
      const t = world();
      t.events!.chor = { ...t.events!.chor!, start_time: null, end_time: null, days: 3 };
      return t;
    };
    const allDay = { start_time: null, end_time: null };
    expect(split(camp(), args({ set: set({ ...allDay, days: 2 }) })).events![S]!.days).toBe(2);
    expect(split(camp(), args({ set: set(allDay) })).events![S]!.days).toBe(3);
    expect(split(camp(), args({ set: set({ days: 4 }) })).events![S]!.days).toBe(1);
    // Wiersz bez kolumny (sprzed D199) — jeden dzień.
    expect(split(world(), args({ set: set(allDay) })).events![S]!.days).toBe(1);
    const again = split(camp(), args({ set: set({ ...allDay, days: 2 }) }));
    expect(split(again, args({ set: set(allDay) })).events![S]!.days).toBe(2);
    expect(split(again, args({ set: set({ ...allDay, days: 5 }) })).events![S]!.days).toBe(5);
  });

  it('stara seria kończy się dzień wcześniej, nowa wskazuje poprzedniczkę; rodzaj i notatka przechodzą', () => {
    const t = split(world(), args());
    expect(t.events!.chor!.rrule).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261018');
    expect(t.events![S]).toEqual({
      id: S, group_id: 'gf', title: 'Chór', start_date: '2026-10-19', start_time: '18:00', end_time: '19:00', audience: 'group',
      responsible_member_id: 'me', location: null, note: 'Nuty w teczce', rrule: 'FREQ=WEEKLY;BYDAY=MO', kind: 'lesson', split_from: 'chor', days: 1, duration_min: null, deleted_at: null,
    });
  });

  it('wiersz bez notatki i rodzaju (utworzony lokalnie): wartości jak DEFAULT w SQL', () => {
    const t = world();
    put(t, 'events', 'chor', { id: 'chor', group_id: 'gf', title: 'Chór', start_date: '2026-10-05', start_time: '17:00', end_time: null, rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', responsible_member_id: null, deleted_at: null });
    split(t, args());
    expect(t.events![S]).toMatchObject({ note: null, kind: 'event' });
  });

  it('osoba odpowiedzialna spoza grupy albo dziecko → nikt konkretny (D132); uczestnicy tylko z grupy', () => {
    for (const who of ['ola', 'tymek', 'obcy', null]) expect(split(world(), args({ set: set({ responsible_member_id: who }) })).events![S]!.responsible_member_id).toBeNull();
    const t = split(world(), args({ set: set({ audience: 'members' }), participants: [{ id: 'p-tymek', member_id: 'tymek' }, { id: 'p-ola', member_id: 'ola' }, { id: 'p-obcy', member_id: 'obcy' }] }));
    expect(t.event_participants).toEqual({ 'p-tymek': { id: 'p-tymek', group_id: 'gf', event_id: S, member_id: 'tymek', deleted_at: null } });
  });

  it('od dnia podziału przechodzą: wyjątki (bez porzuconych), obecność wszystkich, przekazania, zadania (też zrobione), definicje', () => {
    const t = world();
    const ov = (id: string, date: string, extra: Row = {}) => put(t, 'event_overrides', id, { id, group_id: 'gf', event_id: 'chor', occurrence_date: date, cancelled: false, deleted_at: null, ...extra });
    ov('o12', '2026-10-12');
    ov('o19', '2026-10-19', { title: 'Próba' });
    ov('o26', '2026-10-26', { cancelled: true });
    ov('o02', '2026-11-02', { deleted_at: '2026-10-01T00:00:00Z' });
    const rsvp = (id: string, date: string, member: string) => put(t, 'event_rsvps', id, { id, group_id: 'gf', event_id: 'chor', occurrence_date: date, member_id: member, answer: 'no', deleted_at: null });
    rsvp('r12', '2026-10-12', 'me');
    rsvp('r19', '2026-10-19', 'ala');
    const ho = (id: string, date: string | null, status: string, entity = 'events', entity_id = 'chor') => put(t, 'handoffs', id, { id, group_id: 'gf', entity, entity_id, occurrence_date: date, from_member: 'me', to_member: 'ala', status });
    ho('h12', '2026-10-12', 'pending');
    ho('h26', '2026-10-26', 'declined');
    ho('hall', null, 'pending');
    ho('hold', null, 'accepted');
    ho('htask', null, 'pending', 'tasks', 'chor');
    const task = (id: string, date: string, extra: Row = {}) => put(t, 'tasks', id, { id, group_id: 'gf', list_id: 'l', title: id, event_id: 'chor', occurrence_date: date, deadline_mode: 'event', completed_at: null, deleted_at: null, ...extra });
    task('k12', '2026-10-12');
    task('k19', '2026-10-19', { completed_at: '2026-10-08T10:00:00Z' });
    put(t, 'tasks', 'inny', { id: 'inny', group_id: 'gf', list_id: 'l', title: 'inny', event_id: null, occurrence_date: null, deleted_at: null });
    put(t, 'event_task_series', 'def', { id: 'def', group_id: 'gf', event_id: 'chor', list_id: 'l', title: 'Nuty', deleted_at: null });
    put(t, 'event_task_series', 'cudza', { id: 'cudza', group_id: 'gf', event_id: 'inne', list_id: 'l', title: 'X', deleted_at: null });
    split(t, args({ drop_overrides: ['o26', 'o12', 'nie-ma'] }));
    expect([t.event_overrides!.o12!.event_id, t.event_overrides!.o12!.deleted_at]).toEqual(['chor', null]); // przed dniem podziału: zostaje (także gdy na liście)
    expect(t.event_overrides!.o19).toMatchObject({ event_id: S, title: 'Próba', deleted_at: null });
    expect(t.event_overrides!.o26).toMatchObject({ event_id: S, deleted_at: 'pending' }); // termin, którego nowa seria nie ma
    expect(t.event_overrides!.o02).toMatchObject({ event_id: S, deleted_at: '2026-10-01T00:00:00Z' });
    expect([t.event_rsvps!.r12!.event_id, t.event_rsvps!.r19!.event_id]).toEqual(['chor', S]);
    expect(Object.fromEntries(Object.values(t.handoffs!).map((h) => [h.id, h.entity_id]))).toEqual({ h12: 'chor', h26: S, hall: S, hold: 'chor', htask: 'chor' });
    expect([t.tasks!.k12!.event_id, t.tasks!.k19!.event_id, t.tasks!.inny!.event_id]).toEqual(['chor', S, null]);
    expect([t.event_task_series!.def!.event_id, t.event_task_series!.cudza!.event_id]).toEqual([S, 'inne']);
  });

  it('decyzje z podglądu: najbliższy termin, odpięcie (termin „jak spotkanie” → bez terminu), kopia do kosza', () => {
    const t = world();
    const task = (id: string, extra: Row = {}) => put(t, 'tasks', id, { id, group_id: 'gf', list_id: 'l', title: id, event_id: 'chor', occurrence_date: '2026-10-19', deadline_mode: 'event', series_id: null, deleted_at: null, ...extra });
    task('a');
    task('b');
    task('c', { deadline_mode: 'own' });
    task('kopia', { series_id: 'def' });
    task('zwykle');
    task('kosz', { series_id: 'def', deleted_at: '2026-10-01T00:00:00Z' });
    task('wczesne', { occurrence_date: '2026-10-12' });
    split(t, args({
      tasks: [
        { id: 'a', action: 'relink', date: '2026-10-20' },
        { id: 'b', action: 'unlink' },
        { id: 'c', action: 'unlink' },
        { id: 'kopia', action: 'delete' },
        { id: 'zwykle', action: 'delete' }, // nie kopia — nie usuwamy
        { id: 'kosz', action: 'delete' },
        { id: 'wczesne', action: 'unlink' }, // nie w nowej serii — bez zmian
        { id: 'nie-ma', action: 'unlink' },
      ],
    }));
    expect(t.tasks!.a).toMatchObject({ event_id: S, occurrence_date: '2026-10-20' });
    expect(t.tasks!.b).toMatchObject({ event_id: null, occurrence_date: null, deadline_mode: 'none' });
    expect(t.tasks!.c).toMatchObject({ event_id: null, occurrence_date: null, deadline_mode: 'own' });
    expect(t.tasks!.kopia!.deleted_at).toBe('pending');
    expect(t.tasks!.zwykle!.deleted_at).toBeNull();
    expect(t.tasks!.kosz!.deleted_at).toBe('2026-10-01T00:00:00Z');
    expect(t.tasks!.wczesne).toMatchObject({ event_id: 'chor', occurrence_date: '2026-10-12' });
  });

  it('czego serwer nie przyjmie, tu nic nie zmienia: brak serii, seria usunięta, bez reguły, start przed dniem podziału', () => {
    const empty: T = {};
    expect(split(empty, args())).toEqual({ events: {} });
    const gone = world();
    gone.events!.chor = { ...gone.events!.chor!, deleted_at: '2026-10-01T00:00:00Z' };
    expect(split(gone, args()).events![S]).toBeUndefined();
    const once = world();
    once.events!.chor = { ...once.events!.chor!, rrule: null };
    expect(split(once, args()).events![S]).toBeUndefined();
    expect(split(world(), args({ set: set({ start_date: '2026-10-18' }) })).events![S]).toBeUndefined();
  });

  it('polecenie powtórzone (drugi telefon, ten sam termin): wartości nowej serii jak przy zmianie całości, bez ponownego dzielenia', () => {
    const t = split(world(), args({ set: set({ audience: 'members' }), participants: [{ id: 'p-tymek', member_id: 'tymek' }] }));
    put(t, 'event_participants', 'p-ala', { id: 'p-ala', group_id: 'gf', event_id: S, member_id: 'ala', deleted_at: 'x' });
    put(t, 'event_participants', 'p-ola', { id: 'p-ola', group_id: 'gf', event_id: S, member_id: 'ola', deleted_at: 'x' });
    put(t, 'event_overrides', 'o26', { id: 'o26', group_id: 'gf', event_id: 'chor', occurrence_date: '2026-10-26', deleted_at: null });
    const before = t.events!.chor;
    split(t, args({ set: set({ title: 'Chór — nowa sala', start_time: '19:00', end_time: null, audience: 'members', rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231' }), participants: [{ id: 'p-ala2', member_id: 'ala' }, { id: 'p-ola2', member_id: 'ola' }, { id: 'p-me', member_id: 'me' }] }));
    expect(t.events!.chor).toBe(before);
    expect(t.events![S]).toMatchObject({ title: 'Chór — nowa sala', start_time: '19:00', end_time: null, rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231', split_from: 'chor' });
    expect(t.event_overrides!.o26!.event_id).toBe('chor');
    const parts = Object.fromEntries(Object.values(t.event_participants!).map((p) => [p.member_id, p.deleted_at]));
    expect(parts).toEqual({ tymek: 'pending', ala: null, ola: 'x', me: null }); // Ola nie wraca — nie ma jej w grupie
    expect(t.event_participants!['p-me']).toMatchObject({ event_id: S });
    expect(t.event_participants!['p-ala2']).toBeUndefined(); // Ala wraca na swoim wierszu
  });

  it('powtórzone polecenie: nowa seria z następczynią zachowuje swój koniec; usunięta albo nie z podziału — nic', () => {
    const t = split(world(), args());
    const later = splitId(S, '2026-11-02');
    split(t, args({ id: later, event_id: S, date: '2026-11-02', set: set({ start_date: '2026-11-02' }) }));
    expect(t.events![S]!.rrule).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261101');
    split(t, args({ set: set({ start_time: '20:00' }) }));
    expect(t.events![S]).toMatchObject({ start_time: '20:00', rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261101' });
    // Jednorazowa nowa seria (podział „nie powtarza się”) z następczynią — bez reguły.
    split(t, args({ set: set({ rrule: null }) }));
    expect(t.events![S]!.rrule).toBeNull();
    const removed = split(world(), args());
    removed.events![S] = { ...removed.events![S]!, deleted_at: 'x' };
    split(removed, args({ set: set({ title: 'Inny' }) }));
    expect(removed.events![S]!.title).toBe('Chór');
    const plain = world();
    put(plain, 'events', S, { id: S, group_id: 'gf', title: 'Zwykłe', split_from: null, deleted_at: null });
    split(plain, args());
    expect(plain.events![S]!.title).toBe('Zwykłe');
    const other = world();
    put(other, 'events', S, { id: S, group_id: 'gx', title: 'Obce', split_from: 'chor', deleted_at: null });
    split(other, args());
    expect(other.events![S]!.title).toBe('Obce');
  });

  it('drugi telefon podzielił wcześniej (19.10): podział od 26.10 dzieli następczynię', () => {
    const t = split(world(), args());
    put(t, 'event_overrides', 'o02', { id: 'o02', group_id: 'gf', event_id: S, occurrence_date: '2026-11-02', deleted_at: null });
    put(t, 'event_overrides', 'o19', { id: 'o19', group_id: 'gf', event_id: S, occurrence_date: '2026-10-19', deleted_at: null });
    const B = splitId('chor', '2026-10-26');
    split(t, args({ id: B, date: '2026-10-26', set: set({ start_date: '2026-10-26', start_time: '20:00' }) }));
    expect(t.events!.chor!.rrule).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261018');
    expect(t.events![S]!.rrule).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261025');
    expect(t.events![B]).toMatchObject({ split_from: S, start_time: '20:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
    expect([t.event_overrides!.o19!.event_id, t.event_overrides!.o02!.event_id]).toEqual([S, B]);
  });

  it('drugi telefon podzielił później (2.11): podział od 19.10 wchodzi między — bez dubli, następczyni zostaje', () => {
    const t = world();
    const A = splitId('chor', '2026-11-02');
    split(t, args({ id: A, date: '2026-11-02', set: set({ start_date: '2026-11-02', start_time: '19:30' }) }));
    put(t, 'event_overrides', 'o26', { id: 'o26', group_id: 'gf', event_id: 'chor', occurrence_date: '2026-10-26', deleted_at: null });
    put(t, 'event_overrides', 'o09', { id: 'o09', group_id: 'gf', event_id: A, occurrence_date: '2026-11-09', deleted_at: null });
    put(t, 'event_task_series', 'def', { id: 'def', group_id: 'gf', event_id: 'chor', list_id: 'l', title: 'Nuty', deleted_at: null });
    put(t, 'handoffs', 'hall', { id: 'hall', group_id: 'gf', entity: 'events', entity_id: 'chor', occurrence_date: null, status: 'pending' });
    split(t, args());
    expect(t.events!.chor!.rrule).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261018');
    expect(t.events![S]).toMatchObject({ split_from: 'chor', rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261101' });
    expect(t.events![A]).toMatchObject({ split_from: S, start_time: '19:30' });
    expect([t.event_overrides!.o26!.event_id, t.event_overrides!.o09!.event_id]).toEqual([S, A]);
    // Nowa seria nie jest najnowsza: definicje i przekazanie całej serii zostają, gdzie były (stałe zadania i tak działają na
    // cały łańcuch — fillOps).
    expect([t.event_task_series!.def!.event_id, t.handoffs!.hall!.entity_id]).toEqual(['chor', 'chor']);
  });

  it('uszkodzony łańcuch: dwie następczynie (najwcześniejsza, przy równym dniu — mniejszy identyfikator); pętla nie zawiesza', () => {
    const t = world();
    t.events!.chor = { ...t.events!.chor!, rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261011' };
    const ev = (id: string, start: string, from: string, rrule: string) => put(t, 'events', id, { id, group_id: 'gf', title: id, start_date: start, rrule, split_from: from, deleted_at: null });
    ev('b2', '2026-10-12', 'chor', 'FREQ=WEEKLY;BYDAY=MO');
    ev('b1', '2026-10-12', 'chor', 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261012');
    ev('c1', '2026-10-26', 'chor', 'FREQ=WEEKLY;BYDAY=MO');
    split(t, args());
    expect(t.events![S]!.split_from).toBe('b1');
    const loop = world();
    loop.events!.chor = { ...loop.events!.chor!, rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261011', split_from: 'x' };
    put(loop, 'events', 'x', { id: 'x', group_id: 'gf', title: 'x', start_date: '2026-10-12', rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261012', split_from: 'chor', deleted_at: null });
    split(loop, args());
    expect(loop.events![S]!.split_from).toBe('x');
  });

  it('bez tabeli osób (np. tylko wiersz wydarzenia) i z następczynią bez końca dzielonej: dzieli tę serię', () => {
    const t: T = {};
    put(t, 'events', 'chor', { id: 'chor', group_id: 'gf', title: 'Chór', start_date: '2026-10-05', rrule: 'FREQ=WEEKLY;BYDAY=MO', deleted_at: null });
    put(t, 'events', 'potem', { id: 'potem', group_id: 'gf', title: 'Chór', start_date: '2026-11-02', rrule: 'FREQ=WEEKLY;BYDAY=MO', split_from: 'chor', deleted_at: null });
    split(t, args());
    expect(t.events![S]).toMatchObject({ split_from: 'chor', responsible_member_id: null, rrule: 'FREQ=WEEKLY;BYDAY=MO' });
    expect(t.events!.potem!.split_from).toBe(S);
  });

  it('w silniku synchronizacji: polecenie split_event działa lokalnie, inne polecenia nie', () => {
    const t = world();
    applyOp(t, { seq: 1, op_id: 'o1', kind: 'cmd', cmd: 'split_event', args: args() as unknown as Row } as Op);
    expect(t.events![S]).toBeDefined();
    const before = structuredClone(t);
    applyOp(t, { seq: 2, op_id: 'o2', kind: 'cmd', cmd: 'move_task', args: { id: 'x' } } as Op);
    expect(t).toEqual(before);
  });
});
