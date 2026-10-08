import type { Row } from '../sync-engine/client';
import { addresseeRequired, lacksAddressee } from '../views/addressee';
import { createTask } from '../views/commands';
import { parseQuickAdd } from '../quickadd';

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
function world(): T {
  const t: T = {};
  put(t, 'groups', 'gp', { id: 'gp', name: 'Osobiste', kind: 'personal', deleted_at: null });
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', deleted_at: null });
  put(t, 'group_members', 'mp', { member_id: 'mp', group_id: 'gp', user_id: ME, role: 'owner', deleted_at: null });
  put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, role: 'admin', deleted_at: null });
  put(t, 'lists', 'lp', { id: 'lp', group_id: 'gp', kind: 'tasks', name: 'Moje', deleted_at: null });
  put(t, 'lists', 'lf', { id: 'lf', group_id: 'gf', kind: 'tasks', name: 'Dzisiaj', deleted_at: null });
  put(t, 'lists', 'lz', { id: 'lz', group_id: 'gf', kind: 'shopping', name: 'Zakupy', deleted_at: null });
  put(t, 'lists', 'lx', { id: 'lx', group_id: 'gx', kind: 'tasks', name: 'Obca', deleted_at: null });
  put(t, 'lists', 'lprv', { id: 'lprv', group_id: 'gf', kind: 'tasks', name: 'Prezenty', visibility: 'private', owner_member_id: 'mf', deleted_at: null });
  return t;
}

describe('adresat zadania (D68)', () => {
  it('wymagany tylko dla zadań głównych na listach zadań grup wspólnych', () => {
    const t = world();
    expect(addresseeRequired(t, ME, 'lf', null)).toBe(true);
    expect(addresseeRequired(t, ME, 'lf', 'rodzic')).toBe(false);
    expect(addresseeRequired(t, ME, 'lp', null)).toBe(false);
    expect(addresseeRequired(t, ME, 'lz', null)).toBe(false);
    expect(addresseeRequired(t, ME, 'lx', null)).toBe(false); // obca grupa
    // Decyzja właściciela z 8.10.2026 (PW-18 A): lista „Tylko ja” działa jak grupa osobista.
    expect(addresseeRequired(t, ME, 'lprv', null)).toBe(false);
    expect(addresseeRequired(t, ME, 'nie-ma', null)).toBe(false);
  });

  const x = { id: 'x', list_id: 'lf', parent_id: null, assignee_member_id: null, deadline_mode: 'none' as const, due_date: null, due_time: null, start_date: null, event_id: null, occurrence_date: null };

  it('brak adresata = bez osoby i bez terminu (własny termin i termin spotkania się liczą)', () => {
    const t = world();
    put(t, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Zebranie', start_date: '2026-10-09', start_time: '18:00:00', rrule: null, deleted_at: null });
    expect(lacksAddressee(t, ME, x)).toBe(true);
    expect(lacksAddressee(t, ME, { ...x, assignee_member_id: 'mf' })).toBe(false);
    expect(lacksAddressee(t, ME, { ...x, deadline_mode: 'own', due_date: '2026-10-09' })).toBe(false);
    expect(lacksAddressee(t, ME, { ...x, deadline_mode: 'event', event_id: 'ev', occurrence_date: '2026-10-09' })).toBe(false);
    expect(lacksAddressee(t, ME, { ...x, list_id: 'lp' })).toBe(false);
  });

  it('audyt 2 (T-15): osoba usunięta z grupy (D132) i odwołany termin spotkania (D14) to brak adresata', () => {
    const t = world();
    put(t, 'group_members', 'ala', { member_id: 'ala', group_id: 'gf', user_id: 'u-ala', role: 'member', deleted_at: '2026-10-07T08:00:00Z' });
    put(t, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Zebranie', start_date: '2026-10-09', start_time: '18:00:00', rrule: null, deleted_at: null });
    put(t, 'event_overrides', 'o', { id: 'o', event_id: 'ev', occurrence_date: '2026-10-09', cancelled: true, deleted_at: null });
    expect(lacksAddressee(t, ME, { ...x, assignee_member_id: 'ala' })).toBe(true);
    expect(lacksAddressee(t, ME, { ...x, assignee_member_id: 'nieznany' })).toBe(true);
    expect(lacksAddressee(t, ME, { ...x, deadline_mode: 'event', event_id: 'ev', occurrence_date: '2026-10-09' })).toBe(true);
    expect(lacksAddressee(t, ME, { ...x, deadline_mode: 'own', due_date: null })).toBe(true);
    expect(lacksAddressee(t, ME, { ...x, assignee_member_id: 'ala', deadline_mode: 'own', due_date: '2026-10-09' })).toBe(false);
  });

  it('nowe zadanie z osobą wybraną po dodaniu', () => {
    const p = parseQuickAdd('rosół', { y: 2026, m: 10, d: 7, hh: 10, mm: 0 });
    expect(createTask({ id: 't', groupId: 'gf', listId: 'lf', parsed: p, assigneeId: 'mf' })).toMatchObject({ set: { assignee_member_id: 'mf', deadline_mode: 'none' } });
    expect(createTask({ id: 't', groupId: 'gf', listId: 'lf', parsed: p }).kind === 'create' && 'assignee_member_id' in (createTask({ id: 't', groupId: 'gf', listId: 'lf', parsed: p }) as { set: object }).set).toBe(false);
  });
});
