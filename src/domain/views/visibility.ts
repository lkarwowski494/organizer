/**
 * Kto widzi listę — ta sama reguła co serwer (`private.member_can_see_list`,
 * supabase/migrations/20261006120100_lists_tasks.sql): żywy członek grupy listy, a lista jest „cała grupa”, albo jest
 * jej właścicielem, albo (lista „wybrane osoby”) ma żywy wpis w object_members. Osoba spoza tej reguły nie może dostać
 * zadania ani zakupów z tej listy — serwer odrzuca taki zapis (`invalid_assignee`, `invalid_member`; audyt 2: T-3,
 * R-3–R-6, T-10).
 */
import { asList, asMember, rows, type Tables } from './model';

export function memberCanSeeList(t: Tables, memberId: string, listId: string): boolean {
  const l = t.lists?.[listId] ? asList(t.lists[listId]!) : null;
  if (!l) return false;
  const m = rows(t, 'group_members', asMember).find((x) => x.member_id === memberId && x.group_id === l.group_id && x.deleted_at === null);
  if (!m) return false;
  if (l.visibility === 'group' || l.owner_member_id === memberId) return true;
  return l.visibility === 'restricted' && Object.values(t.object_members ?? {}).some((o) => o.scope_entity === 'lists' && o.scope_id === listId && o.member_id === memberId && o.deleted_at == null);
}
