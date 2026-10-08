import type { Row } from '../sync-engine/client';
import { assignmentsToNotify } from '../views/assignments';

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);

describe('o które przypisania poprosić o push (D81)', () => {
  it('moje przypisanie komuś innemu (zadanie, zakupy, wydarzenie), świeże; nie sobie, nie cudze, nie bez osoby', () => {
    const t: T = {};
    put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
    put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
    const NOW = Date.parse('2026-10-07T12:00:00Z');
    const a = (id: string, extra: Row) => put(t, 'activity', id, { id, group_id: 'gf', entity: 'tasks', actor_member_id: 'mf', changes: { assignee_member_id: [null, 'mm'] }, created_at: '2026-10-07T11:00:00Z', ...extra });
    a('a-task', { verb: 'create' }); // utworzenie z osobą (bez tabeli zadań na telefonie — nie kopia)
    a('b-list', { entity: 'lists', changes: { responsible_member_id: ['mf', 'mm'] } });
    a('c-self', { changes: { assignee_member_id: ['mm', 'mf'] } });
    a('d-cleared', { changes: { assignee_member_id: ['mm', null] } });
    a('e-other-actor', { actor_member_id: 'mm' });
    a('f-old', { created_at: '2026-10-05T11:00:00Z' });
    a('g-title', { changes: { title: ['a', 'b'] } });
    a('h-event', { entity: 'events', changes: { responsible_member_id: [null, 'mm'] } });
    a('i-alien', { group_id: 'obca' });
    a('j-nodate', { created_at: undefined });
    a('k-nochanges', { changes: undefined });
    // D88: wydarzenie (cała seria) i jeden termin serii.
    a('l-override', { entity: 'event_overrides', changes: { responsible_member_id: [null, 'mm'] } });
    a('m-participant', { entity: 'event_participants', changes: { member_id: [null, 'mm'] } });
    expect(assignmentsToNotify(t, ME, NOW, 24)).toEqual(['a-task', 'b-list', 'h-event', 'l-override']);
    expect(assignmentsToNotify({}, ME, NOW, 24)).toEqual([]);
  });
});

describe('kopia zadania powtarzanego to nie przypisanie (audyt 2: N-6, T-24)', () => {
  // Odhaczam cotygodniowe „Wynieś śmieci” Ali (albo mój telefon robi kopię D133) — kopia niesie osobę ze źródła.
  it('utworzenie kopii (id = nextId źródła) — bez prośby o push; zwykłe utworzenie i późniejsza zmiana osoby — z prośbą', () => {
    const t: T = {};
    put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
    put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
    put(t, 'group_members', 'ala', { member_id: 'ala', group_id: 'gf', user_id: 'u-ala', display_name: 'Ala', role: 'member', deleted_at: null });
    put(t, 'lists', 'l', { id: 'l', group_id: 'gf', kind: 'tasks', name: 'Dom', visibility: 'group', deleted_at: null });
    const task = (id: string, extra: Row = {}) =>
      put(t, 'tasks', id, { id, group_id: 'gf', list_id: 'l', parent_id: null, title: 'Wynieś śmieci', assignee_member_id: 'ala', deadline_mode: 'own', due_date: '2026-10-07', due_time: null, completed_at: null, deleted_at: null, rollover: true, repeat: 'FREQ=WEEKLY;BYDAY=WE', ...extra });
    const smieci = 'cccc0000-0000-7000-8000-0000000004d1';
    // Identyfikatory kopii policzone niezależnie (Python: uuid.uuid5(REPEAT_NAMESPACE, '<id>|next')).
    const copy = '3131726b-47cd-530b-8635-592f07fad345';
    const copy2 = 'ddd3b400-0594-5a0a-8416-e7df937cb9e6';
    task(smieci, { completed_at: '2026-10-07T10:00:00Z' });
    task(copy, { due_date: '2026-10-14' });
    task(copy2, { due_date: '2026-10-21' });
    task('t-nowe', { repeat: null });
    const a = (id: string, entityId: string, extra: Row = {}) =>
      put(t, 'activity', id, { id, group_id: 'gf', entity: 'tasks', entity_id: entityId, verb: 'create', actor_member_id: 'mf', changes: { assignee_member_id: [null, 'ala'] }, created_at: '2026-10-07T11:00:00Z', ...extra });
    a('a-copy', copy);
    a('b-copy2', copy2);
    a('c-new', 't-nowe');
    a('d-reassign', copy, { verb: 'update', changes: { assignee_member_id: ['mf', 'ala'] } });
    // Kopia, której nie ma na telefonie (np. już w koszu i wyczyszczona) — decyduje serwer.
    a('e-unknown', 'cccc0000-0000-7000-8000-0000000004ff');
    expect(assignmentsToNotify(t, ME, Date.parse('2026-10-07T12:00:00Z'), 24)).toEqual(['c-new', 'd-reassign', 'e-unknown']);
  });
});
