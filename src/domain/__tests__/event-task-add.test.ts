/** Pole „Dodaj zadanie” na ekranie wydarzenia — „@imię” jak na liście (audyt 3, N-51). */
import type { Row } from '../sync-engine/client';
import { eventTaskOps, seriesMention } from '../views/event-task-add';

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
function base(): T {
  const t: T = {};
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  const m = (id: string, user: string | null, name: string, role = 'member') => put(t, 'group_members', id, { member_id: id, group_id: 'gf', user_id: user, display_name: name, role, deleted_at: null });
  m('mf', ME, 'Łukasz', 'admin');
  m('ala', 'u-ala', 'Ala');
  m('alek', 'u-alek', 'Alek');
  put(t, 'lists', 'lf', { id: 'lf', group_id: 'gf', kind: 'tasks', name: 'Dom', visibility: 'group', owner_member_id: null, sort_key: 'a0', deleted_at: null });
  put(t, 'tasks', 't0', { id: 't0', group_id: 'gf', list_id: 'lf', parent_id: null, title: 'stare', sort_key: 'a0', deleted_at: null });
  return t;
}
const a = (o: Partial<Parameters<typeof eventTaskOps>[2]> = {}) => {
  let n = 0;
  return { groupId: 'gf', eventId: 'ev', occurrenceDate: '2026-10-07', listId: 'lf', text: 'namiot @Ala', series: false, newId: () => `n${++n}`, ...o };
};
const ev = { parent_id: null, deadline_mode: 'event', due_date: null, due_time: null, event_id: 'ev', occurrence_date: '2026-10-07' };

describe('eventTaskOps', () => {
  it('„@Ala” — osoba, „@” znika z nazwy; klucz za ostatnim zadaniem listy', () => {
    expect(eventTaskOps(base(), ME, a())).toEqual({ kind: 'ok', ops: [{ kind: 'create', entity: 'tasks', id: 'n1', group_id: 'gf', set: { list_id: 'lf', title: 'namiot', sort_key: 'a1', assignee_member_id: 'ala', ...ev } }] });
    expect(eventTaskOps(base(), ME, a({ text: '  karimata   dla dzieci ' }))).toMatchObject({ kind: 'ok', ops: [{ set: { title: 'karimata dla dzieci' } }] });
  });

  it('kilka osób — pytanie, potem wybór; nikt — pytanie, potem bez osoby z „@” w nazwie; sama osoba — pusto', () => {
    const t = base();
    const many = eventTaskOps(t, ME, a({ text: 'woda @Al' }));
    expect(many).toMatchObject({ kind: 'many', name: 'Al' });
    const pick = many.kind === 'many' ? many.targets.find((x) => x.memberId === 'alek')! : null;
    expect(eventTaskOps(t, ME, a({ text: 'woda @Al' }), { person: pick! })).toMatchObject({ kind: 'ok', ops: [{ set: { title: 'woda', assignee_member_id: 'alek' } }] });
    expect(eventTaskOps(t, ME, a({ text: 'woda @Zosia' }))).toEqual({ kind: 'unknown', name: 'Zosia' });
    expect(eventTaskOps(t, ME, a({ text: 'woda @Zosia' }), { skipMention: true })).toMatchObject({ kind: 'ok', ops: [{ set: { title: 'woda @Zosia' } }] });
    expect(eventTaskOps(t, ME, a({ text: '@Ala' }))).toEqual({ kind: 'empty' });
  });

  it('grupa bez listy zadań: lista „Zadania” i osoba z grupy (nowa lista jest całej grupy)', () => {
    const t = base();
    delete t.lists!.lf;
    expect(eventTaskOps(t, ME, a({ listId: null }))).toEqual({
      kind: 'ok',
      ops: [
        { kind: 'create', entity: 'lists', id: 'n1', group_id: 'gf', set: { kind: 'tasks', name: 'Zadania', visibility: 'group' } },
        { kind: 'create', entity: 'tasks', id: 'n2', group_id: 'gf', set: { list_id: 'n1', title: 'namiot', sort_key: 'a0', assignee_member_id: 'ala', ...ev } },
      ],
    });
  });

  it('na każdy termin serii: definicja bez osoby, „@imię” zostaje w nazwie', () => {
    expect(eventTaskOps(base(), ME, a({ series: true }))).toEqual({ kind: 'ok', ops: [{ kind: 'create', entity: 'event_task_series', id: 'n1', group_id: 'gf', set: { event_id: 'ev', list_id: 'lf', title: 'namiot @Ala' } }] });
    expect(seriesMention('namiot @Ala')).toBe(true);
    expect(seriesMention('namiot')).toBe(false);
  });
});
