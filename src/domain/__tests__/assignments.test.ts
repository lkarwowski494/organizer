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
    a('a-task', {});
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
