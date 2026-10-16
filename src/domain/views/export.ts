/**
 * Eksport danych użytkownika do formatu JSON (BRD: Z-013, ZP-11, NIGDY-04).
 * Umożliwia pobranie pełnej kopii grup, list, zadań i wydarzeń użytkownika.
 * Zgodny z zasadami: Offline-First, brak paywalla, format otwarty JSON.
 */
import { asEvent } from './event-rows';
import { asGroup, asList, asMember, asTask, type Member, rows, type Tables } from './model';
import { memberCanSeeList } from './visibility';

export type UserExport = {
  version: 1;
  exportedAt: string;
  userId: string;
  groups: {
    id: string;
    name: string;
    kind: 'personal' | 'shared';
    color: string | null;
    myRole: 'owner' | 'admin' | 'member' | 'child';
    members: {
      memberId: string;
      displayName: string;
      role: 'owner' | 'admin' | 'member' | 'child';
    }[];
  }[];
  lists: {
    id: string;
    groupId: string;
    name: string;
    kind: 'tasks' | 'shopping';
    visibility: 'group' | 'restricted' | 'private';
  }[];
  tasks: {
    id: string;
    groupId: string;
    listId: string;
    parentId: string | null;
    title: string;
    note: string | null;
    dueDate: string | null;
    dueTime: string | null;
    completedAt: string | null;
  }[];
  events: {
    id: string;
    groupId: string;
    title: string;
    startDate: string;
    startTime: string | null;
    endTime: string | null;
    location: string | null;
    rrule: string | null;
  }[];
};

const alive = <T extends { deleted_at: string | null }>(x: T) => x.deleted_at === null;

/**
 * Generuje kompletny, otwarty zrzut JSON danych użytkownika ze wszystkich jego grup.
 */
export function buildUserExport(t: Tables, userId: string, exportedAtIso: string): UserExport {
  const allMembers = rows(t, 'group_members', asMember).filter(alive);
  const myMembers = allMembers.filter((m) => m.user_id === userId);
  const myGroupMap = new Map<string, Member>(myMembers.map((m) => [m.group_id, m]));
  const groupIds = new Set(myGroupMap.keys());

  const groups = rows(t, 'groups', asGroup)
    .filter((g) => alive(g) && groupIds.has(g.id))
    .sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === 'personal' ? -1 : 1;
      }
      return a.name.localeCompare(b.name, 'pl');
    })
    .map((g) => {
      const me = myGroupMap.get(g.id)!;
      const members = allMembers
        .filter((m) => m.group_id === g.id)
        .map((m) => ({
          memberId: m.member_id,
          displayName: m.display_name,
          role: m.role,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pl'));

      return {
        id: g.id,
        name: g.name,
        kind: g.kind,
        color: g.color,
        myRole: me.role,
        members,
      };
    });

  const lists = rows(t, 'lists', asList)
    .filter((l) => {
      if (!alive(l)) return false;
      const me = myGroupMap.get(l.group_id);
      return me !== undefined && memberCanSeeList(t, me.member_id, l.id);
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'))
    .map((l) => ({
      id: l.id,
      groupId: l.group_id,
      name: l.name,
      kind: l.kind,
      visibility: l.visibility,
    }));

  const visibleListIds = new Set(lists.map((l) => l.id));

  const tasks = rows(t, 'tasks', asTask)
    .filter((task) => alive(task) && groupIds.has(task.group_id) && visibleListIds.has(task.list_id))
    .sort((a, b) => {
      const aDue = a.due_date ?? '9999-99-99';
      const bDue = b.due_date ?? '9999-99-99';
      const diff = aDue.localeCompare(bDue);
      if (diff !== 0) return diff;
      return a.title.localeCompare(b.title, 'pl');
    })
    .map((task) => ({
      id: task.id,
      groupId: task.group_id,
      listId: task.list_id,
      parentId: task.parent_id,
      title: task.title,
      note: task.note,
      dueDate: task.due_date,
      dueTime: task.due_time,
      completedAt: task.completed_at,
    }));

  const events = rows(t, 'events', asEvent)
    .filter((e) => alive(e) && groupIds.has(e.group_id))
    .sort((a, b) => {
      if (a.start_date !== b.start_date) {
        return a.start_date.localeCompare(b.start_date);
      }
      return a.title.localeCompare(b.title, 'pl');
    })
    .map((e) => ({
      id: e.id,
      groupId: e.group_id,
      title: e.title,
      startDate: e.start_date,
      startTime: e.start_time,
      endTime: e.end_time,
      location: e.location,
      rrule: e.rrule,
    }));

  return {
    version: 1,
    exportedAt: exportedAtIso,
    userId,
    groups,
    lists,
    tasks,
    events,
  };
}
