import { buildUserExport } from '../views/export';
import type { Tables } from '../views/model';

describe('BRD Z-013, ZP-11, NIGDY-04: Eksport danych użytkownika do formatu JSON', () => {
  it('generuje ustrukturyzowany zrzut danych JSON tylko z grup użytkownika, pomijając obcych i kosz', () => {
    const t: Tables = {
      groups: {
        g_shared_b: { id: 'g_shared_b', name: 'Dom B', kind: 'shared', color: '#00ff00', deleted_at: null },
        g_personal_b: { id: 'g_personal_b', name: 'Prywatna 2', kind: 'personal', color: '#ff00ff', deleted_at: null },
        g_shared_a: { id: 'g_shared_a', name: 'Dom A', kind: 'shared', color: '#0000ff', deleted_at: null },
        g_personal_a: { id: 'g_personal_a', name: 'Prywatna 1', kind: 'personal', color: '#ff0000', deleted_at: null },
        g_stranger: { id: 'g_stranger', name: 'Obcy', kind: 'shared', color: null, deleted_at: null },
        g_deleted: { id: 'g_deleted', name: 'Kosz', kind: 'shared', color: null, deleted_at: '2026-10-10T10:00:00Z' },
      },
      group_members: {
        m_me_personal_a: { member_id: 'm_me_personal_a', group_id: 'g_personal_a', user_id: 'u_me', display_name: 'Ja', role: 'owner', deleted_at: null },
        m_me_personal_b: { member_id: 'm_me_personal_b', group_id: 'g_personal_b', user_id: 'u_me', display_name: 'Ja', role: 'owner', deleted_at: null },
        m_me_b: { member_id: 'm_me_b', group_id: 'g_shared_b', user_id: 'u_me', display_name: 'Łukasz', role: 'member', deleted_at: null },
        m_me_a: { member_id: 'm_me_a', group_id: 'g_shared_a', user_id: 'u_me', display_name: 'Łukasz', role: 'admin', deleted_at: null },
        m_other_a: { member_id: 'm_other_a', group_id: 'g_shared_a', user_id: 'u_other', display_name: 'Ala', role: 'member', deleted_at: null },
        m_stranger: { member_id: 'm_stranger', group_id: 'g_stranger', user_id: 'u_stranger', display_name: 'Obcy', role: 'owner', deleted_at: null },
      },
      lists: {
        l_tasks: { id: 'l_tasks', group_id: 'g_shared_a', kind: 'tasks', name: 'Zadania', visibility: 'group', deleted_at: null },
        l_shopping: { id: 'l_shopping', group_id: 'g_shared_a', kind: 'shopping', name: 'Zakupy', visibility: 'group', deleted_at: null },
        l_secret_me: { id: 'l_secret_me', group_id: 'g_shared_a', kind: 'tasks', name: 'Mój sekret', visibility: 'private', owner_member_id: 'm_me_a', deleted_at: null },
        l_secret_other: { id: 'l_secret_other', group_id: 'g_shared_a', kind: 'tasks', name: 'Sekret Ali', visibility: 'private', owner_member_id: 'm_other_a', deleted_at: null },
        l_deleted: { id: 'l_deleted', group_id: 'g_shared_a', kind: 'tasks', name: 'Usunięta', visibility: 'group', deleted_at: '2026-10-10T10:00:00Z' },
        l_foreign: { id: 'l_foreign', group_id: 'g_stranger', kind: 'tasks', name: 'Obca', visibility: 'group', deleted_at: null },
      },
      tasks: {
        t_early: { id: 't_early', group_id: 'g_shared_a', list_id: 'l_tasks', parent_id: null, title: 'Wcześnie', note: null, due_date: '2026-10-10', due_time: null, completed_at: null, deleted_at: null },
        t1: { id: 't1', group_id: 'g_shared_a', list_id: 'l_tasks', parent_id: null, title: 'Zrobić pranie', note: 'kolory', due_date: '2026-10-15', due_time: '10:00', completed_at: null, deleted_at: null },
        t2: { id: 't2', group_id: 'g_shared_a', list_id: 'l_tasks', parent_id: 't1', title: 'Powiesić', note: null, due_date: '2026-10-15', due_time: null, completed_at: '2026-10-15T12:00:00Z', deleted_at: null },
        t_no_due_b: { id: 't_no_due_b', group_id: 'g_shared_a', list_id: 'l_tasks', parent_id: null, title: 'Kupić bilet', note: null, due_date: null, due_time: null, completed_at: null, deleted_at: null },
        t_no_due_a: { id: 't_no_due_a', group_id: 'g_shared_a', list_id: 'l_tasks', parent_id: null, title: 'Auto przegląd', note: null, due_date: null, due_time: null, completed_at: null, deleted_at: null },
        t4_del: { id: 't4_del', group_id: 'g_shared_a', list_id: 'l_tasks', parent_id: null, title: 'Stare', note: null, due_date: null, due_time: null, completed_at: null, deleted_at: '2026-10-10T10:00:00Z' },
        t_foreign: { id: 't_foreign', group_id: 'g_stranger', list_id: 'l_foreign', parent_id: null, title: 'Obce', note: null, due_date: null, due_time: null, completed_at: null, deleted_at: null },
      },
      events: {
        ev1: { id: 'ev1', group_id: 'g_shared_a', title: 'Spotkanie', start_date: '2026-10-20', start_time: '18:00', end_time: '19:00', location: 'Biuro', rrule: null, deleted_at: null },
        ev2: { id: 'ev2', group_id: 'g_shared_a', title: 'Dentysta', start_date: '2026-10-20', start_time: '09:00', end_time: null, location: null, rrule: null, deleted_at: null },
        ev3: { id: 'ev3', group_id: 'g_shared_a', title: 'Urodziny', start_date: '2026-10-25', start_time: null, end_time: null, location: null, rrule: 'FREQ=YEARLY', deleted_at: null },
        ev_del: { id: 'ev_del', group_id: 'g_shared_a', title: 'Anulowane', start_date: '2026-10-22', start_time: null, end_time: null, location: null, rrule: null, deleted_at: '2026-10-10T10:00:00Z' },
        ev_foreign: { id: 'ev_foreign', group_id: 'g_stranger', title: 'Obce', start_date: '2026-10-20', start_time: null, end_time: null, location: null, rrule: null, deleted_at: null },
      },
    };

    const exp = buildUserExport(t, 'u_me', '2026-10-16T10:00:00.000Z');

    expect(exp.version).toBe(1);
    expect(exp.exportedAt).toBe('2026-10-16T10:00:00.000Z');
    expect(exp.userId).toBe('u_me');

    // Grupy osobiste najpierw (alfabetycznie: Prywatna 1, Prywatna 2), potem wspólne (Dom A, Dom B)
    expect(exp.groups.map((g) => g.id)).toEqual(['g_personal_a', 'g_personal_b', 'g_shared_a', 'g_shared_b']);
    expect(exp.groups.find((g) => g.id === 'g_shared_a')?.members.map((m) => m.displayName)).toEqual(['Ala', 'Łukasz']);

    // Listy widoczne: bez obcych, bez usuniętych i bez prywatnej listy Ali
    expect(exp.lists.map((l) => l.id)).toEqual(['l_secret_me', 'l_tasks', 'l_shopping']);

    // Zadania z posortowaniem:
    // 1) 2026-10-10 (t_early)
    // 2) 2026-10-15: 'Powiesić' (t2) przed 'Zrobić pranie' (t1)
    // 3) bez daty: 'Auto przegląd' (t_no_due_a) przed 'Kupić bilet' (t_no_due_b)
    expect(exp.tasks.map((t) => t.id)).toEqual(['t_early', 't2', 't1', 't_no_due_a', 't_no_due_b']);

    // Wydarzenia: ta sama data (Dentysta przed Spotkanie wg alfabetu), potem 2026-10-25
    expect(exp.events.map((e) => e.id)).toEqual(['ev2', 'ev1', 'ev3']);
  });

  it('działa poprawnie dla pustej bazy bez grup', () => {
    const exp = buildUserExport({}, 'u_empty', '2026-10-16T10:00:00.000Z');
    expect(exp).toEqual({
      version: 1,
      exportedAt: '2026-10-16T10:00:00.000Z',
      userId: 'u_empty',
      groups: [],
      lists: [],
      tasks: [],
      events: [],
    });
  });
});
