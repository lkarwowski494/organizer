import type { CivilDate } from '../civil-date';
import type { Row } from '../sync-engine/client';
import { buildWidgetPayload } from '../views/widget';

const ME = 'u-me';
const TODAY: CivilDate = { y: 2026, m: 10, d: 7 }; // środa
const local = (iso: string) => iso.slice(0, 10);

type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);

function world(): T {
  const t: T = {};
  put(t, 'groups', 'gp', { id: 'gp', name: 'Osobiste', kind: 'personal', line: 0, created_at: '2026-01-01T00:00:00Z', deleted_at: null });
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', line: 1, created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  put(t, 'group_members', 'mp', { member_id: 'mp', group_id: 'gp', user_id: ME, display_name: 'Ja', role: 'owner', deleted_at: null });
  put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
  put(t, 'group_members', 'mc', { member_id: 'mc', group_id: 'gf', user_id: null, display_name: 'Tymek', role: 'child', deleted_at: null });
  put(t, 'lists', 'lp', { id: 'lp', group_id: 'gp', kind: 'tasks', name: 'Moje', visibility: 'group', sort_key: 'a0', deleted_at: null });
  put(t, 'lists', 'lf', { id: 'lf', group_id: 'gf', kind: 'tasks', name: 'Dom', visibility: 'group', sort_key: 'a0', deleted_at: null });
  put(t, 'lists', 'ls', { id: 'ls', group_id: 'gf', kind: 'shopping', name: 'Zakupy', visibility: 'group', sort_key: 'a1', deleted_at: null });
  return t;
}

function task(t: T, id: string, over: Row = {}) {
  put(t, 'tasks', id, { id, group_id: 'gp', list_id: 'lp', parent_id: null, title: id, deadline_mode: 'own', due_date: '2026-10-07', due_time: null, start_date: null, completed_at: null, deleted_at: null, ...over });
}

function ev(t: T, id: string, date: string, over: Row = {}) {
  put(t, 'events', id, { id, group_id: 'gp', title: id, start_date: date, start_time: '17:00:00', end_time: null, rrule: null, audience: 'group', deleted_at: null, ...over });
}

describe('widżet „Moje sprawy” (D17, BRD B4)', () => {
  it('pusta baza: poprawny payload z domyślnym scopeOf i maxItems', () => {
    const t = world();
    const payload = buildWidgetPayload({
      tables: t,
      userId: ME,
      today: TODAY,
      nowIso: '2026-10-07T12:00:00.000Z',
      localIso: local,
    });

    expect(payload.version).toBe(1);
    expect(payload.today).toBe('2026-10-07');
    expect(payload.dayLabel).toBe('Środa, 7 października');
    expect(payload.totalRemainingCount).toBe(0);
    expect(payload.items).toEqual([]);
  });

  it('zawiera zaległe zadania, dzisiejsze wydarzenia i zadania z deep linkami', () => {
    const t = world();
    // 1. Zadanie zaległe z wczoraj z godziną
    task(t, 't-wczoraj', { title: 'Zapłacić rachunek', due_date: '2026-10-06', due_time: '14:00' });
    // 2. Dzisiejsze wydarzenie z godzinami
    ev(t, 'e-zebranie', '2026-10-07', { title: 'Zebranie szkolne', start_time: '16:30:00', end_time: '17:30:00', group_id: 'gf' });
    // 3. Dzisiejsze zadanie z godziną
    task(t, 't-dzis-godzina', { title: 'Telefon do lekarza', due_date: '2026-10-07', due_time: '18:00' });
    // 4. Dzisiejsze zadanie całodniowe
    task(t, 't-dzis-caly-dzien', { title: 'Wynieść śmieci', due_date: '2026-10-07', due_time: null });
    // 5. Wycieczka zakupowa (zaplanowane zakupy na liście)
    put(t, 'lists', 'ls', { id: 'ls', group_id: 'gf', kind: 'shopping', name: 'Zakupy', visibility: 'group', due_date: '2026-10-07', due_time: null, responsible_member_id: 'mf', sort_key: 'a1', deleted_at: null });

    const payload = buildWidgetPayload({
      tables: t,
      userId: ME,
      today: TODAY,
      nowIso: '2026-10-07T12:00:00.000Z',
      localIso: local,
      maxItems: 4,
    });

    expect(payload.totalRemainingCount).toBe(5);
    expect(payload.items.length).toBe(4);

    // Pierwsze powinno być zaległe zadanie
    expect(payload.items[0]).toEqual({
      id: 't-wczoraj',
      title: 'Zapłacić rachunek',
      time: '14:00',
      kind: 'task',
      groupName: 'Osobiste',
      groupLine: 0,
      groupColor: '#1D4ED8',
      isOverdue: true,
      deepLink: 'organizer://task/t-wczoraj',
    });

    // Drugie: całodniowe zadanie (w agendzie zadania bez godziny są przed tymi z godziną)
    expect(payload.items[1]!.title).toBe('Wynieść śmieci');
    expect(payload.items[1]!.deepLink).toBe('organizer://task/t-dzis-caly-dzien');

    // Kolejne z godzinami: wydarzenie 16:30
    const zebranie = payload.items.find((x) => x.id === 'e-zebranie');
    expect(zebranie).toBeDefined();
    expect(zebranie?.time).toBe('16:30–17:30');
    expect(zebranie?.groupName).toBe('Rodzina');
    expect(zebranie?.groupColor).toBe('#EA580C');
    expect(zebranie?.deepLink).toBe('organizer://event/e-zebranie?date=2026-10-07');
  });

  it('obsługuje wydarzenia całodniowe oraz z tylko jedną godziną rozpoczęcia', () => {
    const t = world();
    ev(t, 'e-caly-dzien', '2026-10-07', { title: 'Urodziny', start_time: null, end_time: null });
    ev(t, 'e-tylko-start', '2026-10-07', { title: 'Mecz', start_time: '20:00:00', end_time: null });

    const payload = buildWidgetPayload({
      tables: t,
      userId: ME,
      today: TODAY,
      nowIso: '2026-10-07T12:00:00.000Z',
      localIso: local,
    });

    const urodziny = payload.items.find((x) => x.id === 'e-caly-dzien');
    expect(urodziny?.time).toBeNull();

    const mecz = payload.items.find((x) => x.id === 'e-tylko-start');
    expect(mecz?.time).toBe('20:00');
  });

  it('obsługuje blok lekcji dziecka (lessons) z przedziałem godzin i bez końca', () => {
    const t = world();
    // Lekcja dla dziecka mc w grupie gf
    ev(t, 'e-lekcja', '2026-10-05', {
      group_id: 'gf',
      title: 'Matematyka',
      kind: 'lesson',
      start_time: '08:00:00',
      end_time: '08:45:00',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
      audience: 'members',
    });
    put(t, 'event_participants', 'p-lekcja', {
      id: 'p-lekcja',
      event_id: 'e-lekcja',
      member_id: 'mc',
      deleted_at: null,
    });

    const payload = buildWidgetPayload({
      tables: t,
      userId: ME,
      today: TODAY,
      nowIso: '2026-10-07T12:00:00.000Z',
      localIso: local,
      scopeOf: () => 'all',
    });

    const lessonItem = payload.items.find((x) => x.kind === 'lessons');
    expect(lessonItem).toBeDefined();
    expect(lessonItem?.id).toBe('mc');
    expect(lessonItem?.groupName).toBe('Rodzina');
    expect(lessonItem?.deepLink).toBe('organizer://today');
    expect(lessonItem?.time).toBe('08:00–08:45');
  });

  it('obsługuje zaległe zakupy z koszyka wycieczki zakupowej', () => {
    const t = world();
    // Zaległa wycieczka zakupowa z wczoraj
    put(t, 'lists', 'ls', {
      id: 'ls',
      group_id: 'gf',
      kind: 'shopping',
      name: 'Supermarket',
      visibility: 'group',
      due_date: '2026-10-06',
      due_time: null,
      responsible_member_id: 'mf',
      sort_key: 'a1',
      deleted_at: null,
    });

    const payload = buildWidgetPayload({
      tables: t,
      userId: ME,
      today: TODAY,
      nowIso: '2026-10-07T12:00:00.000Z',
      localIso: local,
    });

    const trip = payload.items.find((x) => x.kind === 'trip');
    expect(trip).toBeDefined();
    expect(trip?.isOverdue).toBe(true);
    expect(trip?.deepLink).toBe('organizer://list/ls');
  });

  it('obsługuje brakujące lub ujemne numery linii grupy', () => {
    const t = world();
    put(t, 'groups', 'g-custom', { id: 'g-custom', name: 'Inna', kind: 'shared', line: -5, created_at: '2026-01-01T00:00:00Z', deleted_at: null });
    put(t, 'group_members', 'm-custom', { member_id: 'm-custom', group_id: 'g-custom', user_id: ME, display_name: 'Ja', role: 'member', deleted_at: null });
    put(t, 'lists', 'l-custom', { id: 'l-custom', group_id: 'g-custom', kind: 'tasks', name: 'Zadania', visibility: 'group', sort_key: 'a0', deleted_at: null });
    task(t, 't-inna', { group_id: 'g-custom', list_id: 'l-custom', title: 'Zadanie w innej grupie', due_date: '2026-10-07' });

    const payload = buildWidgetPayload({
      tables: t,
      userId: ME,
      today: TODAY,
      nowIso: '2026-10-07T12:00:00.000Z',
      localIso: local,
    });

    const item = payload.items.find((x) => x.id === 't-inna');
    expect(item).toBeDefined();
    expect(item?.groupColor).toBe('#1D4ED8'); // fallback do pierwszej linii (blue)
  });

  it('zadania zakończone nie są uwzględniane w liczniku ani na liście widżetu', () => {
    const t = world();
    task(t, 't-zrobione', { title: 'Zrobione rano', due_date: '2026-10-07', completed_at: '2026-10-07T08:00:00Z' });
    task(t, 't-do-zrobienia', { title: 'Do zrobienia', due_date: '2026-10-07', completed_at: null });

    const payload = buildWidgetPayload({
      tables: t,
      userId: ME,
      today: TODAY,
      nowIso: '2026-10-07T12:00:00.000Z',
      localIso: local,
    });

    expect(payload.totalRemainingCount).toBe(1);
    expect(payload.items.length).toBe(1);
    expect(payload.items[0]!.id).toBe('t-do-zrobienia');
  });
});
