/**
 * Audyt 3, PK-05: seria po „to i następne” to łańcuch części, a dla użytkownika jedna seria (N-3, N-21, N-22, N-23,
 * N-113, N-115, N-116, N-117, N-135). Reprodukcje audytu (seria pon. 17:00 od 5.10, „ten i następne” od 2.11 na 18:00)
 * z oczekiwaniem po poprawce, lokalne skutki poleceń end_series / restore_series / split_event (follow) — ten sam algorytm
 * co SQL (tests/db/event-split.test.ts).
 */
import { applyEndSeries, applyRestoreSeries, chainIds, chainOwner, chainParts, endSeriesEffects, repointLate } from '../event-chain';
import { applySplit, splitId, type SplitArgs } from '../event-split';
import { parseIsoDate } from '../format';
import { parseRule } from '../rrule';
import { applyOp, type NewOp, type Op, type Row } from '../sync-engine/client';
import { inverseOps, plainChanges } from '../views/commands';
import { affectedByCancel, nextInSeries, nextOccurrence, seriesCopiesCancelOps, seriesEditEffects, seriesEditOps } from '../views/event-tasks';
import { cancelEvent, editEvent, eventDetail, type EventFields, expandEvents, fieldsOf, groupSeries, type RuleLabels, seriesEnd, seriesRule } from '../views/events';
import { handoffSubjects, incomingHandoffs, outgoingPending } from '../views/handoffs';
import { answerOps, rsvpView } from '../views/rsvp';

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, id: string, row: Row) => ((t[e] ??= {})[id] = row);
let seq = 0;
const run = (t: T, ops: NewOp[]) => {
  for (const op of ops) applyOp(t, { ...op, seq: ++seq, op_id: `op${seq}` } as Op);
  return t;
};
const D = parseIsoDate;
const L: RuleLabels = { every: () => 'Co tydzień', weekdays: (b, d) => `${b}: ${d.join(',')}`, nth: (b) => b, monthDay: (b) => b, until: (u) => `, do ${u.d}.${u.m}`, count: (n) => `, ${n} razy` };

function world(): T {
  const t: T = {};
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-01-01T00:00:00Z', deleted_at: null });
  put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
  put(t, 'group_members', 'ala', { member_id: 'ala', group_id: 'gf', user_id: 'u-ala', display_name: 'Ala', role: 'member', deleted_at: null });
  put(t, 'group_members', 'tymek', { member_id: 'tymek', group_id: 'gf', user_id: null, display_name: 'Tymek', role: 'child', deleted_at: null });
  put(t, 'lists', 'dom', { id: 'dom', group_id: 'gf', kind: 'tasks', name: 'Dom', visibility: 'group', deleted_at: null });
  put(t, 'events', 'chor', { id: 'chor', group_id: 'gf', title: 'Chór', start_date: '2026-10-05', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', responsible_member_id: 'mf', location: null, days: 1, duration_min: null, split_from: null, deleted_at: null });
  return t;
}
const det = (t: T, id: string) => eventDetail(t, ME, id)!;
const brief = (t: T, from: string, to: string) => expandEvents(t, ME, D(from), D(to)).map((x) => `${x.date} ${x.startTime?.slice(0, 5)} ${x.title}`);
const B = splitId('chor', '2026-11-02');
/** „Od 2.11 o 18:00” (ten i następne) — seria B od 2.11. */
const splitAtNov2 = () => {
  const t = world();
  const f = fieldsOf(det(t, 'chor'), '2026-11-02', 'following');
  run(t, editEvent(det(t, 'chor'), '2026-11-02', 'following', { ...f, startTime: '18:00', endTime: '19:00' }, f));
  return t;
};
const edit = (t: T, id: string, date: string, scope: 'following' | 'all', over: Partial<EventFields>) => {
  const loaded = fieldsOf(det(t, id), date, scope);
  return editEvent(det(t, id), date, scope, { ...loaded, ...over }, loaded);
};

describe('N-3: „Usuń całą serię”, „Odwołaj ten i następne”, „Zmień wszystkie” na całym łańcuchu', () => {
  it('„Usuń całą serię” z terminu starej części usuwa też część od 2.11', () => {
    const t = splitAtNov2();
    run(t, cancelEvent(det(t, 'chor'), '2026-10-26', 'all'));
    expect(brief(t, '2026-10-05', '2026-11-30')).toEqual([]);
  });

  it('„Usuń całą serię” z terminu nowej części usuwa też starą część', () => {
    const t = splitAtNov2();
    run(t, cancelEvent(det(t, B), '2026-11-09', 'all'));
    expect(brief(t, '2026-10-05', '2026-11-30')).toEqual([]);
  });

  it('„Odwołaj ten i następne” z terminu sprzed podziału odwołuje też terminy od 2.11', () => {
    const t = splitAtNov2();
    run(t, cancelEvent(det(t, 'chor'), '2026-10-19', 'following'));
    expect(brief(t, '2026-10-12', '2026-11-30')).toEqual(['2026-10-12 17:00 Chór']);
    expect(t.events![B]!.deleted_at).not.toBeNull();
  });

  it('„Zmień wszystkie” (nazwa) z terminu nowej części zmienia też starą część; godziny części zostają', () => {
    const t = splitAtNov2();
    run(t, edit(t, B, '2026-11-09', 'all', { title: 'Próba' }));
    expect(brief(t, '2026-10-26', '2026-11-09')).toEqual(['2026-10-26 17:00 Próba', '2026-11-02 18:00 Próba', '2026-11-09 18:00 Próba']);
  });

  it('„Zmień wszystkie”: nowe dni tygodnia w każdej części od jej początku, z jej końcem; wyjątki spoza nowej reguły do kosza', () => {
    const t = splitAtNov2();
    put(t, 'event_overrides', 'o9', { id: 'o9', event_id: B, occurrence_date: '2026-11-09', cancelled: true, deleted_at: null });
    const ops = edit(t, 'chor', '2026-10-19', 'all', { rule: parseRule('FREQ=WEEKLY;BYDAY=WE') });
    run(t, ops);
    expect(brief(t, '2026-10-26', '2026-11-12')).toEqual(['2026-10-28 17:00 Chór', '2026-11-04 18:00 Chór', '2026-11-11 18:00 Chór']);
    expect(t.events![B]!.start_date).toBe('2026-11-04');
    expect(t.event_overrides!.o9!.deleted_at).not.toBeNull();
  });

  it('„Zmień wszystkie” na jednorazowe: pozostałe części do kosza', () => {
    const t = splitAtNov2();
    run(t, edit(t, 'chor', '2026-10-19', 'all', { rule: null, date: '2026-10-19' }));
    expect(brief(t, '2026-10-01', '2026-11-30')).toEqual(['2026-10-19 17:00 Chór']);
  });

  it('„Zmień wszystkie” bez pól z chwili otwarcia (starszy ekran): inne części porównane z obecnym stanem', () => {
    const t = splitAtNov2();
    run(t, editEvent(det(t, 'chor'), '2026-10-19', 'all', { ...fieldsOf(det(t, 'chor'), '2026-10-19', 'all'), title: 'Próba' }));
    expect(brief(t, '2026-10-26', '2026-11-02')).toEqual(['2026-10-26 17:00 Próba', '2026-11-02 18:00 Próba']);
  });

  it('uczestnicy w „wszystkie” — dopisani i skreśleni w każdej części', () => {
    const t = splitAtNov2();
    run(t, edit(t, 'chor', '2026-10-19', 'all', { audience: 'members', participantIds: ['tymek'] }));
    const live = (id: string) => Object.values(t.event_participants ?? {}).filter((p) => p.event_id === id && p.deleted_at == null).map((p) => p.member_id);
    expect([live('chor'), live(B)]).toEqual([['tymek'], ['tymek']]);
    expect(t.events![B]!.audience).toBe('members');
  });

  it('„ten i następne” od pierwszego terminu późniejszej części: ta i następne, bez wcześniejszych', () => {
    const t = splitAtNov2();
    run(t, edit(t, B, '2026-11-02', 'following', { title: 'Próba' }));
    expect(brief(t, '2026-10-26', '2026-11-02')).toEqual(['2026-10-26 17:00 Chór', '2026-11-02 18:00 Próba']);
  });
});

describe('N-21: koniec serii to koniec ostatniej części', () => {
  it('formularz i opis starej części: bez końca, choć część kończy się 1.11', () => {
    const t = splitAtNov2();
    expect(fieldsOf(det(t, 'chor'), '2026-10-26', 'following').until).toBeNull();
    expect(seriesEnd(det(t, 'chor'))).toBeNull();
    expect(seriesRule(det(t, 'chor'))!.until).toBeNull();
    expect(seriesRule(det(t, B))).toEqual(det(t, B).rule);
    expect(seriesRule(eventDetail({ ...t, events: { ...t.events, one: { id: 'one', group_id: 'gf', title: 'Raz', start_date: '2026-10-08', rrule: null, deleted_at: null } } }, ME, 'one')!)).toBeNull();
  });

  it('„Zmień wszystkie” na starej części bez zmiany końca nie daje dubli od 2.11 (wcześniej zdjęcie końca części)', () => {
    const t = splitAtNov2();
    run(t, edit(t, 'chor', '2026-10-19', 'all', { title: 'Chór dzieci' }));
    expect(brief(t, '2026-11-02', '2026-11-02')).toEqual(['2026-11-02 18:00 Chór dzieci']);
  });

  it('koniec ustawiony w starej części: późniejsza część kończy się wtedy; przed jej początkiem — do kosza', () => {
    const t = splitAtNov2();
    run(t, edit(t, 'chor', '2026-10-19', 'all', { until: '2026-11-15' }));
    expect(brief(t, '2026-10-26', '2026-11-30')).toEqual(['2026-10-26 17:00 Chór', '2026-11-02 18:00 Chór', '2026-11-09 18:00 Chór']);
    expect(fieldsOf(det(t, 'chor'), '2026-10-26', 'all').until).toBe('2026-11-15');
    run(t, edit(t, 'chor', '2026-10-19', 'all', { until: '2026-10-25' }));
    expect(brief(t, '2026-10-12', '2026-11-30')).toEqual(['2026-10-12 17:00 Chór', '2026-10-19 17:00 Chór']);
    expect(t.events![B]!.deleted_at).not.toBeNull();
  });

  it('koniec przez COUNT w ostatniej części — jako dzień ostatniego terminu', () => {
    const t = splitAtNov2();
    t.events![B] = { ...t.events![B]!, rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=3' };
    expect(seriesEnd(det(t, 'chor'))).toBe('2026-11-16');
    // Bez zmiany końca ostatnia część zostaje z COUNT.
    expect(edit(t, 'chor', '2026-10-19', 'all', { title: 'X' }).find((o) => o.kind === 'patch' && o.id === B)).toEqual({ kind: 'patch', entity: 'events', id: B, set: { title: 'X' } });
  });
});

describe('N-22, N-135: „ten i następne” przed wcześniejszym podziałem', () => {
  it('nazwa od 26.10 obowiązuje też od 2.11; godzina późniejszej części zostaje; podgląd pokazuje terminy obu części', () => {
    const t = splitAtNov2();
    const ops = edit(t, 'chor', '2026-10-26', 'following', { title: 'Próba chóru' });
    expect(seriesEditEffects(t, det(t, 'chor'), '2026-10-26', 'following', ops).preview).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
    run(t, ops);
    expect(brief(t, '2026-10-26', '2026-11-09')).toEqual(['2026-10-26 17:00 Próba chóru', '2026-11-02 18:00 Próba chóru', '2026-11-09 18:00 Próba chóru']);
  });

  it('godzina od 26.10 — także w późniejszej części; dni tygodnia z jej początku, a jej wyjątki spoza nowej reguły do kosza', () => {
    const t = splitAtNov2();
    put(t, 'event_overrides', 'o9', { id: 'o9', event_id: B, occurrence_date: '2026-11-09', title: 'Koncert', cancelled: false, deleted_at: null });
    const ops = edit(t, 'chor', '2026-10-26', 'following', { startTime: '16:00', endTime: '17:00', rule: parseRule('FREQ=WEEKLY;BYDAY=TU') });
    expect(seriesEditEffects(t, det(t, 'chor'), '2026-10-26', 'following', ops).overridesLost).toBe(1);
    run(t, ops);
    expect(brief(t, '2026-10-26', '2026-11-10')).toEqual(['2026-10-27 16:00 Chór', '2026-11-03 16:00 Chór', '2026-11-10 16:00 Chór']);
    expect(t.event_overrides!.o9!.deleted_at).not.toBeNull();
  });

  it('nowy koniec przed późniejszą częścią — ona do kosza (jej stałe zadania przechodzą do nowej części)', () => {
    const t = splitAtNov2();
    put(t, 'event_task_series', 'nuty', { id: 'nuty', group_id: 'gf', event_id: B, list_id: 'dom', title: 'Nuty', deleted_at: null });
    run(t, edit(t, 'chor', '2026-10-19', 'following', { until: '2026-10-26' }));
    const S = splitId('chor', '2026-10-19');
    expect(brief(t, '2026-10-12', '2026-11-30')).toEqual(['2026-10-12 17:00 Chór', '2026-10-19 17:00 Chór', '2026-10-26 17:00 Chór']);
    expect(t.event_task_series!.nuty).toMatchObject({ event_id: S, deleted_at: null });
  });

  it('uczestnicy dopisani od 26.10 — też w późniejszej części; nic niezmienione — bez wpisu dla niej', () => {
    const t = splitAtNov2();
    const ops = edit(t, 'chor', '2026-10-26', 'following', { audience: 'members', participantIds: ['tymek'] });
    run(t, ops);
    expect(Object.values(t.event_participants!).filter((p) => p.event_id === B && p.deleted_at == null).map((p) => p.member_id)).toEqual(['tymek']);
    const same = edit(splitAtNov2(), 'chor', '2026-10-26', 'following', { startTime: '17:00:00' });
    expect((same[0] as unknown as { args: SplitArgs }).args.follow).toBeUndefined();
  });

  it('N-135: drugi telefon zmienił nazwę i miejsce przy otwartym formularzu — nowa część dostaje je, ja zmieniam tylko godzinę', () => {
    const t = world();
    const loaded = fieldsOf(det(t, 'chor'), '2026-10-19', 'following');
    t.events!.chor = { ...t.events!.chor!, title: 'Taniec nowoczesny', location: 'Aula', responsible_member_id: 'ala' };
    put(t, 'event_participants', 'p1', { id: 'p1', event_id: 'chor', member_id: 'tymek', deleted_at: null });
    t.events!.chor = { ...t.events!.chor!, audience: 'members' };
    const [op] = editEvent(det(t, 'chor'), '2026-10-19', 'following', { ...loaded, startTime: '18:00', endTime: '19:00' }, loaded);
    const set = (op as unknown as { args: SplitArgs }).args.set;
    expect([set.title, set.location, set.responsible_member_id, set.start_time, set.audience]).toEqual(['Taniec nowoczesny', 'Aula', 'ala', '18:00', 'members']);
    expect((op as unknown as { args: SplitArgs }).args.participants.map((p) => p.member_id)).toEqual(['tymek']);
    // Cała grupa w obecnym stanie (drugi telefon) — bez uczestników.
    t.events!.chor = { ...t.events!.chor!, audience: 'group' };
    const [op2] = editEvent(det(t, 'chor'), '2026-10-19', 'following', { ...loaded, title: 'X' }, loaded);
    expect((op2 as unknown as { args: SplitArgs }).args.participants).toEqual([]);
  });

  it('zadanie z późniejszej części, którego termin znika po zmianie dni — decyzja z podglądu w tym samym poleceniu', () => {
    const t = splitAtNov2();
    put(t, 'tasks', 'stroj', { id: 'stroj', group_id: 'gf', list_id: 'dom', title: 'Strój', event_id: B, occurrence_date: '2026-11-09', deadline_mode: 'event', series_id: null, completed_at: null, deleted_at: null });
    const draft = edit(t, 'chor', '2026-10-26', 'following', { rule: parseRule('FREQ=WEEKLY;BYDAY=TU') });
    const fx = seriesEditEffects(t, det(t, 'chor'), '2026-10-26', 'following', draft);
    expect(fx.lost.map((x) => [x.task.id, x.nearest, x.eventId])).toEqual([['stroj', '2026-11-10', B]]);
    run(t, seriesEditOps(draft, fx, 'nearest'));
    expect(t.tasks!.stroj).toMatchObject({ event_id: B, occurrence_date: '2026-11-10' });
  });

  it('„wszystkie”: zadanie z innej części, której termin znika — przepięte w jej obrębie', () => {
    const t = splitAtNov2();
    put(t, 'tasks', 'stroj', { id: 'stroj', group_id: 'gf', list_id: 'dom', title: 'Strój', event_id: B, occurrence_date: '2026-11-09', deadline_mode: 'event', series_id: null, completed_at: null, deleted_at: null });
    const draft = edit(t, 'chor', '2026-10-19', 'all', { rule: parseRule('FREQ=WEEKLY;BYDAY=TU') });
    const fx = seriesEditEffects(t, det(t, 'chor'), '2026-10-19', 'all', draft);
    expect(fx.lost.map((x) => [x.task.id, x.nearest, x.eventId])).toEqual([['stroj', '2026-11-10', B]]);
    run(t, seriesEditOps(draft, fx, 'nearest'));
    expect(t.tasks!.stroj).toMatchObject({ event_id: B, occurrence_date: '2026-11-10' });
    // Część do kosza (koniec przed nią): jej zadanie bez najbliższego terminu.
    const t2 = splitAtNov2();
    put(t2, 'tasks', 'stroj', { ...t.tasks!.stroj!, event_id: B, occurrence_date: '2026-11-09' });
    const cut = edit(t2, 'chor', '2026-10-19', 'all', { until: '2026-10-26' });
    expect(seriesEditEffects(t2, det(t2, 'chor'), '2026-10-19', 'all', cut).lost.map((x) => [x.task.id, x.nearest])).toEqual([['stroj', null]]);
    const cut2 = edit(t2, 'chor', '2026-10-19', 'following', { until: '2026-10-26' });
    expect(seriesEditEffects(t2, det(t2, 'chor'), '2026-10-19', 'following', cut2).lost.map((x) => [x.task.id, x.nearest])).toEqual([['stroj', null]]);
  });
});

describe('N-116: ekran grupy — jeden wiersz na serię', () => {
  it('przed dniem podziału: jeden wiersz z części najbliższego terminu, koniec — całej serii; po nim — z nowej części', () => {
    const t = splitAtNov2();
    expect(groupSeries(t, ME, 'gf', { y: 2026, m: 10, d: 20 }, L).map((x) => `${x.id} ${x.time} ${x.next} ${x.summary}`)).toEqual(['chor 17:00–18:00 2026-10-26 Co tydzień: 0']);
    expect(groupSeries(t, ME, 'gf', { y: 2026, m: 11, d: 3 }, L).map((x) => `${x.id} ${x.time} ${x.next}`)).toEqual([`${B} 18:00–19:00 2026-11-09`]);
    t.events![B] = { ...t.events![B]!, rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130' };
    expect(groupSeries(t, ME, 'gf', { y: 2026, m: 10, d: 20 }, L)[0]!.summary).toBe('Co tydzień: 0, do 30.11');
    // Seria już się skończyła — wiersz z ostatniej części, bez najbliższego terminu.
    expect(groupSeries(t, ME, 'gf', { y: 2027, m: 1, d: 1 }, L).map((x) => [x.id, x.next])).toEqual([[B, null]]);
  });
});

describe('N-117: koniec serii zabiera wyjątki i odpowiedzi z terminów, które znikają', () => {
  it('po „Odwołaj ten i następne” i „Nie kończy się” odwołany termin i „nie będę” nie ożywają; „Cofnij” je przywraca', () => {
    const t = world();
    run(t, cancelEvent(det(t, 'chor'), '2026-10-26', 'this'));
    run(t, answerOps(t, { groupId: 'gf', eventId: 'chor', date: '2026-11-02', memberId: 'mf', answer: 'no' }));
    const before = structuredClone(t);
    const ops = cancelEvent(det(t, 'chor'), '2026-10-19', 'following');
    const back = inverseOps(t, ops)!;
    expect(plainChanges(t, ops).map((o) => `${o.kind} ${"entity" in o ? o.entity : ""}`).sort()).toEqual(['delete event_overrides', 'delete event_rsvps', 'patch events']);
    run(t, ops);
    run(t, edit(t, 'chor', '2026-10-12', 'all', { until: null }));
    expect(brief(t, '2026-10-26', '2026-10-26')).toEqual(['2026-10-26 17:00 Chór']);
    expect(rsvpView(t, ME, 'chor', '2026-11-02')!.people.find((p) => p.me)!.answer).toBeNull();
    // Cofnięcie zaraz po odwołaniu (stan sprzed przedłużenia).
    const undone = structuredClone(before);
    run(undone, ops);
    run(undone, back);
    expect(undone.events!.chor!.rrule).toBe(before.events!.chor!.rrule);
    expect(Object.values(undone.event_rsvps!).every((r) => r.deleted_at == null)).toBe(true);
    expect(brief(undone, '2026-10-26', '2026-10-26')).toEqual([]);
  });

  it('endSeriesEffects: nic do zmiany — bez cofnięcia; cała seria — usunięcia części (cofnięcie przywraca je i stałe zadania)', () => {
    const t = splitAtNov2();
    expect(endSeriesEffects(t, { event_id: 'chor', date: '2027-01-01' }).changed).toEqual([{ kind: 'patch', entity: 'events', id: B, set: { rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231' } }]);
    t.events![B] = { ...t.events![B]!, rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130' };
    expect(endSeriesEffects(t, { event_id: 'chor', date: '2027-01-01' })).toEqual({ changed: [], undo: null });
    put(t, 'event_task_series', 'nuty', { id: 'nuty', group_id: 'gf', event_id: B, list_id: 'dom', title: 'Nuty', deleted_at: null });
    const fx = endSeriesEffects(t, { event_id: B, date: null, title: 'Chór' });
    expect(fx.undo).toEqual({ kind: 'cmd', cmd: 'restore_series', args: { event_id: B, title: 'Chór', events: ['chor', B], parts: [], overrides: [], rsvps: [] } });
    run(t, cancelEvent(det(t, B), '2026-11-09', 'all'));
    expect(t.event_task_series!.nuty!.deleted_at).toBe(t.events![B]!.deleted_at);
    run(t, [fx.undo!]);
    expect([t.events!.chor!.deleted_at, t.events![B]!.deleted_at, t.event_task_series!.nuty!.deleted_at]).toEqual([null, null, null]);
  });

  it('odwołanie od dnia: stałe zadania z usuwanych części przechodzą do części, która zostaje', () => {
    const t = splitAtNov2();
    put(t, 'event_task_series', 'nuty', { id: 'nuty', group_id: 'gf', event_id: B, list_id: 'dom', title: 'Nuty', deleted_at: null });
    run(t, cancelEvent(det(t, 'chor'), '2026-10-19', 'following'));
    expect(t.event_task_series!.nuty).toMatchObject({ event_id: 'chor', deleted_at: null });
  });
});

describe('end_series / restore_series na telefonie — przypadki brzegowe (jak SQL)', () => {
  it('nieznana albo usunięta seria — bez zmian; część jednorazowa i część skończona wcześniej — bez zmian', () => {
    const t = splitAtNov2();
    const copy = structuredClone(t);
    applyEndSeries(t, { event_id: 'nie-ma', date: null });
    applyEndSeries(t, { event_id: 'chor', date: '2026-10-19' }, 'x');
    expect(t.events![B]!.deleted_at).toBe('x');
    const again = structuredClone(t);
    applyEndSeries(t, { event_id: B, date: null });
    expect(t).toEqual(again);
    const t2: T = { events: { one: { id: 'one', group_id: 'g', start_date: '2026-10-01', rrule: null, deleted_at: null } } };
    applyEndSeries(t2, { event_id: 'one', date: '2026-10-05' });
    expect(t2.events!.one!.deleted_at).toBeNull();
    const t3: T = { events: { s: { id: 's', group_id: 'g', start_date: '2026-10-01', rrule: 'FREQ=DAILY;UNTIL=20261003', deleted_at: null } } };
    applyEndSeries(t3, { event_id: 's', date: '2026-10-05' });
    expect(t3.events!.s!.rrule).toBe('FREQ=DAILY;UNTIL=20261003');
    expect(copy.events!.chor!.deleted_at).toBeNull();
  });

  it('restore_series: tylko wiersze tego łańcucha i tej grupy; wyjątki i odpowiedzi tylko przy żywej części; stałe zadania tylko przy żywej liście', () => {
    const t = splitAtNov2();
    put(t, 'events', 'obce', { id: 'obce', group_id: 'gx', title: 'Obce', start_date: '2026-10-01', split_from: 'chor', rrule: null, deleted_at: 'd' });
    put(t, 'events', 'inne', { id: 'inne', group_id: 'gf', title: 'Inne', start_date: '2026-10-01', rrule: null, deleted_at: 'd' });
    put(t, 'event_overrides', 'o1', { id: 'o1', event_id: 'inne', occurrence_date: '2026-10-01', deleted_at: 'd' });
    put(t, 'event_overrides', 'o2', { id: 'o2', event_id: 'chor', occurrence_date: '2026-10-12', deleted_at: 'd' });
    put(t, 'event_rsvps', 'r1', { id: 'r1', event_id: B, occurrence_date: '2026-11-09', deleted_at: 'd' });
    put(t, 'event_task_series', 'nuty', { id: 'nuty', group_id: 'gf', event_id: B, list_id: 'stara', title: 'Nuty', deleted_at: 'd' });
    put(t, 'lists', 'stara', { id: 'stara', group_id: 'gf', kind: 'tasks', deleted_at: 'x' });
    t.events![B] = { ...t.events![B]!, deleted_at: 'd' };
    applyRestoreSeries(t, { event_id: 'nie-ma', events: [], parts: [], overrides: [], rsvps: [] });
    applyRestoreSeries(t, { event_id: 'chor', events: ['obce', 'inne', 'chor', B], parts: [{ id: 'inne', rrule: 'X' }, { id: 'chor', rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261101' }], overrides: ['o1', 'o2', 'brak'], rsvps: ['r1'] });
    expect([t.events!.obce!.deleted_at, t.events!.inne!.deleted_at, t.events![B]!.deleted_at, t.events!.inne!.rrule]).toEqual(['d', 'd', null, null]);
    expect([t.event_overrides!.o1!.deleted_at, t.event_overrides!.o2!.deleted_at, t.event_rsvps!.r1!.deleted_at, t.event_task_series!.nuty!.deleted_at]).toEqual(['d', null, null, 'd']);
    const empty: T = {};
    applyRestoreSeries(empty, { event_id: 'x', events: [], parts: [], overrides: [], rsvps: [] });
    applyEndSeries(empty, { event_id: 'x', date: null });
    expect(empty).toEqual({ events: {} });
  });

  it('łańcuch: części w kosztu też należą do łańcucha; części w kolejności dni', () => {
    const t = splitAtNov2();
    run(t, edit(t, B, '2026-11-16', 'following', { title: 'Trzecia' }));
    const C = splitId(B, '2026-11-16');
    expect([...chainIds(t.events!, C)].sort()).toEqual(['chor', B, C].sort());
    expect(chainParts(t.events!, C).map((e) => e.id)).toEqual(['chor', B, C]);
    expect(chainOwner(t.events!, 'chor', '2026-11-23')).toBe(C);
    expect(chainOwner(t.events!, 'chor', '2026-10-12')).toBe('chor');
    expect(chainOwner(t.events!, 'nie-ma', '2026-10-12')).toBe('nie-ma');
    // Zapętlony (uszkodzony) łańcuch — bezpiecznik.
    t.events!.chor = { ...t.events!.chor!, split_from: C };
    expect(chainOwner(t.events!, C, '2027-01-01')).toBe(C);
  });
});

describe('N-23: spóźnione zapisy z telefonu, który nie znał podziału, trafiają do części z tym dniem', () => {
  it('odpowiedź, odwołanie, zadanie, przekazanie terminu i przepięcie zadania — jak wyzwalacze chain_repoint', () => {
    const stale = world();
    const t = splitAtNov2();
    run(t, answerOps(stale, { groupId: 'gf', eventId: 'chor', date: '2026-11-09', memberId: 'mf', answer: 'no' }));
    expect(rsvpView(t, ME, B, '2026-11-09')!.people.find((p) => p.me)!.answer).toBe('no');
    run(t, cancelEvent(det(stale, 'chor'), '2026-11-16', 'this'));
    expect(brief(t, '2026-11-16', '2026-11-16')).toEqual([]);
    run(t, [{ kind: 'create', entity: 'tasks', id: 'k', group_id: 'gf', set: { list_id: 'dom', title: 'Strój', event_id: 'chor', occurrence_date: '2026-11-09', deadline_mode: 'event' } }]);
    expect(t.tasks!.k!.event_id).toBe(B);
    run(t, [{ kind: 'patch', entity: 'tasks', id: 'k', set: { event_id: 'chor', occurrence_date: '2026-10-19' } }]);
    expect(t.tasks!.k!.event_id).toBe('chor');
    run(t, [{ kind: 'patch', entity: 'tasks', id: 'k', set: { occurrence_date: '2026-11-23' } }, { kind: 'patch', entity: 'tasks', id: 'k', set: { title: 'Bez zmiany' } }]);
    expect(t.tasks!.k!.event_id).toBe(B);
    run(t, [{ kind: 'create', entity: 'handoffs', id: 'h', group_id: 'gf', set: { entity: 'events', entity_id: 'chor', occurrence_date: '2026-11-09', to_member: 'ala' } }]);
    expect(t.handoffs!.h!.entity_id).toBe(B);
    run(t, [{ kind: 'create', entity: 'handoffs', id: 'h2', group_id: 'gf', set: { entity: 'tasks', entity_id: 'k', occurrence_date: '2026-11-09', to_member: 'ala' } }]);
    expect(t.handoffs!.h2!.entity_id).toBe('k');
    run(t, [{ kind: 'create', entity: 'tasks', id: 'bez', group_id: 'gf', set: { list_id: 'dom', title: 'Bez terminu', event_id: null, occurrence_date: '2026-11-09' } }]);
    run(t, [{ kind: 'create', entity: 'lists', id: 'l2', group_id: 'gf', set: { kind: 'tasks', name: 'L', occurrence_date: '2026-11-09', event_id: 'chor' } }]);
    expect([t.tasks!.bez!.event_id, t.lists!.l2!.event_id]).toEqual([null, 'chor']);
    repointLate(t, 'tasks', 'nie-ma');
  });
});

describe('N-113, N-115: przekazanie serii i terminu', () => {
  const handoff = (t: T, id: string, date: string | null, entity = 'chor') =>
    put(t, 'handoffs', id, { id, group_id: 'gf', entity: 'events', entity_id: entity, occurrence_date: date, from_member: 'ala', to_member: 'mf', status: 'pending' });

  it('cała seria — wszystkie części łańcucha (przekazana pierwsza); „czeka na przyjęcie” przy każdej części', () => {
    const t = splitAtNov2();
    handoff(t, 'h', null, B);
    expect(handoffSubjects(t, { entity: 'events', entity_id: B, occurrence_date: null })).toEqual([B, 'chor']);
    expect(incomingHandoffs(t, ME).map((h) => h.subjects)).toEqual([[B, 'chor']]);
    put(t, 'handoffs', 'moje', { id: 'moje', group_id: 'gf', entity: 'events', entity_id: 'chor', occurrence_date: null, from_member: 'mf', to_member: 'ala', status: 'pending' });
    expect([...outgoingPending(t, ME).keys()].sort()).toEqual([`events|${B}|`, 'events|chor|']);
    expect(handoffSubjects(t, { entity: 'events', entity_id: 'nie-ma', occurrence_date: null })).toEqual([]);
  });

  it('termin odwołany albo spoza reguły — nie ma czego przyjąć; po przywróceniu wraca do skrzynki', () => {
    const t = splitAtNov2();
    handoff(t, 'h', '2026-11-09', B);
    expect(incomingHandoffs(t, ME).map((h) => h.id)).toEqual(['h']);
    const back = inverseOps(t, cancelEvent(det(t, B), '2026-11-09', 'this'))!;
    run(t, cancelEvent(det(t, B), '2026-11-09', 'this'));
    expect(incomingHandoffs(t, ME)).toEqual([]);
    run(t, back);
    expect(incomingHandoffs(t, ME).map((h) => h.id)).toEqual(['h']);
    expect(handoffSubjects(t, { entity: 'events', entity_id: B, occurrence_date: '2026-11-10' })).toEqual([]);
    expect(handoffSubjects(t, { entity: 'events', entity_id: 'nie-ma', occurrence_date: '2026-11-10' })).toEqual([]);
    put(t, 'lists', 'zakupy', { id: 'zakupy', group_id: 'gf', kind: 'shopping', name: 'Zakupy', deleted_at: null });
    expect(handoffSubjects(t, { entity: 'lists', entity_id: 'zakupy', occurrence_date: null })).toEqual(['zakupy']);
  });
});

describe('zadania przy odwołaniu na łańcuchu (D14) i następny termin', () => {
  it('„ten i następne” i cała seria pytają o zadania wszystkich części; „tylko ten” — tylko o ten termin', () => {
    const t = splitAtNov2();
    const task = (id: string, event: string, date: string, series: string | null = null) => put(t, 'tasks', id, { id, group_id: 'gf', list_id: 'dom', title: id, event_id: event, occurrence_date: date, deadline_mode: 'event', series_id: series, completed_at: null, deleted_at: null });
    task('a', 'chor', '2026-10-12');
    task('b', 'chor', '2026-10-26');
    task('c', B, '2026-11-09');
    task('kopia', B, '2026-11-16', 'nuty');
    expect(affectedByCancel(t, det(t, 'chor'), '2026-10-19', 'following').map((x) => x.id)).toEqual(['b', 'c']);
    expect(affectedByCancel(t, det(t, B), '2026-11-09', 'all').map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(affectedByCancel(t, det(t, 'chor'), '2026-10-26', 'this').map((x) => x.id)).toEqual(['b']);
    expect(seriesCopiesCancelOps(t, det(t, 'chor'), '2026-10-19', 'following')).toEqual([{ kind: 'delete', entity: 'tasks', id: 'kopia' }]);
  });

  it('następny termin po ostatnim w starej części — pierwszy w następnej', () => {
    const t = splitAtNov2();
    expect(nextInSeries(t, ME, 'chor', '2026-10-26')).toEqual({ eventId: B, occurrenceDate: '2026-11-02' });
    expect(nextOccurrence(t, ME, B, '2026-10-01')).toBe('2026-10-05');
    run(t, cancelEvent(det(t, 'chor'), '2026-10-05', 'all'));
    expect(nextInSeries(t, ME, 'chor', '2026-10-26')).toBeNull();
  });
});

describe('split_event: późniejsze części (follow) na telefonie — jak SQL', () => {
  const args = (over: Partial<SplitArgs> = {}): SplitArgs => ({
    id: splitId('chor', '2026-10-19'),
    event_id: 'chor',
    date: '2026-10-19',
    set: { title: 'Chór', start_date: '2026-10-19', start_time: '17:00', end_time: '18:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', responsible_member_id: 'mf', location: null },
    participants: [],
    drop_overrides: [],
    tasks: [],
    ...over,
  });
  it('tylko żywe części tego łańcucha po dniu podziału; osoba odpowiedzialna — dorosły w grupie; puste miejsce = brak; długość jak wyzwalacz', () => {
    const t = splitAtNov2();
    put(t, 'events', 'obce', { id: 'obce', group_id: 'gf', title: 'Obce', start_date: '2026-12-01', rrule: null, deleted_at: null });
    put(t, 'events', 'kosz', { id: 'kosz', group_id: 'gf', title: 'Kosz', start_date: '2026-12-01', split_from: B, rrule: null, deleted_at: 'd' });
    put(t, 'events', 'gx', { id: 'gx', group_id: 'gx', title: 'Gx', start_date: '2026-12-01', split_from: B, rrule: null, deleted_at: null });
    const follow = [
      { id: B, set: { title: 'Próba', responsible_member_id: 'tymek', location: '', start_time: null, end_time: null, days: 2 } },
      { id: 'obce', set: { title: 'X' } },
      { id: 'kosz', set: { title: 'X' } },
      { id: 'gx', set: { title: 'X' } },
      { id: 'chor', set: { title: 'X' } },
      { id: splitId('chor', '2026-10-19'), set: { title: 'X' } },
    ];
    applySplit(t, args({ follow }) as unknown as Row);
    expect(t.events![B]).toMatchObject({ title: 'Próba', responsible_member_id: null, location: null, start_time: null, days: 2, duration_min: null });
    expect([t.events!.obce!.title, t.events!.kosz!.title, t.events!.gx!.title, t.events!.chor!.title, t.events![splitId('chor', '2026-10-19')]!.title]).toEqual(['Obce', 'Kosz', 'Gx', 'Chór', 'Chór']);
    // Powtórzone polecenie (drugi telefon) też zmienia późniejsze części; uczestnicy i wyjątki do kosza.
    put(t, 'event_overrides', 'o', { id: 'o', event_id: B, occurrence_date: '2026-11-09', deleted_at: null });
    applySplit(t, args({ follow: [{ id: B, set: { start_time: '18:00', end_time: '19:00' }, participants: [{ id: 'p', member_id: 'tymek' }], drop_overrides: ['o'] }, { id: B }] }) as unknown as Row);
    expect(t.events![B]).toMatchObject({ start_time: '18:00', days: 1 });
    expect([t.event_participants!.p!.event_id, t.event_overrides!.o!.deleted_at]).toEqual([B, 'pending']);
  });
});

describe('przypadki brzegowe gałęzi (pokrycie)', () => {
  it('łańcuch bez tabel stałych zadań, wyjątków i odpowiedzi; część bez kolumny reguły; wyjątek już w koszu', () => {
    const t: T = { events: { a: { id: 'a', group_id: 'g', start_date: '2026-10-05', rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261018', deleted_at: null }, b: { id: 'b', group_id: 'g', start_date: '2026-10-19', split_from: 'a', deleted_at: null } } };
    expect(chainOwner(t.events!, 'b', '2026-10-26')).toBe('b');
    expect(endSeriesEffects(t, { event_id: 'a', date: '2026-10-12' }).changed.map((o) => o.kind)).toEqual(['patch', 'delete']);
    applyEndSeries(t, { event_id: 'a', date: '2026-10-12' });
    expect(t.events!.b!.deleted_at).toBe('pending');
    const u = splitAtNov2();
    put(u, 'event_overrides', 'stary', { id: 'stary', event_id: 'chor', occurrence_date: '2026-10-26', deleted_at: 'd' });
    put(u, 'event_task_series', 'kosz', { id: 'kosz', event_id: B, list_id: 'dom', deleted_at: 'd' });
    expect(endSeriesEffects(u, { event_id: 'chor', date: '2026-10-19' }).changed.filter((o) => o.kind === 'delete' && 'entity' in o && o.entity === 'event_overrides')).toEqual([]);
    applyEndSeries(u, { event_id: 'chor', date: '2026-10-19' });
    expect(u.event_task_series!.kosz!.event_id).toBe(B);
  });

  it('plainChanges: inne polecenia bez zmian; follow bez tabeli wyjątków i z wierszem bez długości', () => {
    const split: NewOp = { kind: 'cmd', cmd: 'split_event', args: {} };
    expect(plainChanges({}, [split])).toEqual([split]);
    const t: T = {
      groups: { g: { id: 'g' } },
      events: { a: { id: 'a', group_id: 'g', start_date: '2026-10-05', start_time: null, rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261025', deleted_at: null }, b: { id: 'b', group_id: 'g', start_date: '2026-10-26', split_from: 'a', rrule: 'FREQ=WEEKLY;BYDAY=MO', deleted_at: null } },
    };
    applySplit(t, { id: 's', event_id: 'a', date: '2026-10-12', set: { title: 'X', start_date: '2026-10-12', start_time: null, end_time: null, rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', responsible_member_id: null, location: null }, participants: [], drop_overrides: [], tasks: [], follow: [{ id: 'b', set: { title: 'Y' } }] } as unknown as Row);
    expect(t.events!.b).toMatchObject({ title: 'Y', days: 1, duration_min: null });
  });

  it('formularz usuniętej serii (bez żywych części); „wszystkie” — tylko uczestnicy w innej części; „ten i następne” bez pól z chwili otwarcia', () => {
    const t = world();
    put(t, 'events', 'raz', { id: 'raz', group_id: 'gf', title: 'Raz', start_date: '2026-10-08', rrule: 'FREQ=WEEKLY;BYDAY=TH;UNTIL=20261029', audience: 'group', deleted_at: '2026-10-07T00:00:00Z' });
    expect(fieldsOf(det(t, 'raz'), '2026-10-08', 'all').until).toBe('2026-10-29');
    const u = splitAtNov2();
    u.events!.chor = { ...u.events!.chor!, audience: 'members' };
    u.events![B] = { ...u.events![B]!, audience: 'members' };
    const ops = edit(u, 'chor', '2026-10-19', 'all', { participantIds: ['ala'] });
    expect(ops.filter((o) => 'id' in o && o.id === B)).toEqual([]);
    expect(ops.some((o) => o.kind === 'create' && o.entity === 'event_participants' && o.set.event_id === B)).toBe(true);
    const [split] = editEvent(det(u, 'chor'), '2026-10-26', 'following', { ...fieldsOf(det(u, 'chor'), '2026-10-26', 'following'), title: 'Nowa' });
    expect((split as unknown as { args: SplitArgs }).args.follow).toEqual([{ id: B, set: { title: 'Nowa' } }]);
  });
});

describe('przypadki brzegowe tabel (pokrycie)', () => {
  it('część bez reguły z następczynią; zapis bez tabeli wydarzeń; cofnięcie bez tabeli odpowiedzi; powtórzony podział bez tabeli wyjątków', () => {
    const events = { a: { id: 'a', group_id: 'g', start_date: '2026-10-05', deleted_at: null }, b: { id: 'b', group_id: 'g', start_date: '2026-10-19', split_from: 'a', deleted_at: null } };
    expect(chainOwner(events, 'a', '2026-10-26')).toBe('a');
    const t: T = { tasks: { k: { id: 'k', event_id: 'x', occurrence_date: '2026-10-26' } } };
    repointLate(t, 'tasks', 'k');
    expect(t.tasks!.k!.event_id).toBe('x');
    const r: T = { events: { a: { ...events.a } }, event_overrides: {} };
    applyRestoreSeries(r, { event_id: 'a', events: [], parts: [], overrides: ['o'], rsvps: ['x'] });
    expect(r.event_rsvps).toBeUndefined();
    const s: T = {
      events: { a: { id: 'a', group_id: 'g', start_date: '2026-10-05', rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261011', deleted_at: null }, s: { id: 's', group_id: 'g', start_date: '2026-10-12', split_from: 'a', rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261018', deleted_at: null }, b: { id: 'b', group_id: 'g', start_date: '2026-10-19', split_from: 's', rrule: 'FREQ=WEEKLY;BYDAY=MO', deleted_at: null } },
    };
    applySplit(s, { id: 's', event_id: 'a', date: '2026-10-12', set: { title: 'X', start_date: '2026-10-12', start_time: null, end_time: null, rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', responsible_member_id: null, location: null }, participants: [], drop_overrides: [], tasks: [], follow: [{ id: 'b', set: { title: 'Y' }, drop_overrides: ['o'] }] } as unknown as Row);
    expect([s.events!.s!.rrule, s.events!.b!.title]).toEqual(['FREQ=WEEKLY;BYDAY=MO;UNTIL=20261018', 'Y']);
  });
});
