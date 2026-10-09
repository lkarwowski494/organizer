/**
 * Dane „rodziny w czasie” do testów wydajności (audyt 3, N-6, N-16): ta sama rodzina używa aplikacji przez `years` lat —
 * rośnie tylko historia. 4 grupy (osobista i rodzinna z dwojgiem dzieci bez konta), plan lekcji 2 × 25 serii tygodniowych,
 * 3 codzienne rutyny, 15 zajęć tygodniowych, termin co 3 dni, 5 zadań codziennych powtarzanych (kopie łańcuchem nextId,
 * zrobione), 10 zadań i 15 zakupów tygodniowo, 8 wpisów historii dziennie z ostatnich 90 dni. Dane deterministyczne.
 */
import { addDays, type CivilDate, formatIsoDate } from '../../civil-date';
import type { Row } from '../../sync-engine/client';
import { nextId } from '../../views/task-repeat';

export const FAMILY_USER = 'u-me';
export const FAMILY_TODAY: CivilDate = { y: 2026, m: 10, d: 9 };

export function familyTables(years: number): { [e: string]: { [id: string]: Row } } {
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let idn = 0;
  const uid = () => `00000000-0000-7000-8000-${(++idn).toString(16).padStart(12, '0')}`;
  const iso = (k: number) => formatIsoDate(addDays(FAMILY_TODAY, k));
  const at = (k: number) => `${iso(k)}T10:00:00Z`;
  const t: { [e: string]: { [id: string]: Row } } = {};
  const put = (e: string, key: string, row: Row) => ((t[e] ??= {})[key] = { version: 1, ...row });
  const start = -Math.round(365 * years);
  const groups: { id: string; me: string; kids: string[]; members: string[]; list: string; shop: string }[] = [];
  for (let g = 0; g < 4; g++) {
    const id = uid();
    put('groups', id, { id, name: `Grupa ${g}`, kind: g === 0 ? 'personal' : 'shared', created_at: at(start), deleted_at: null });
    const me = uid();
    put('group_members', me, { member_id: me, group_id: id, user_id: FAMILY_USER, display_name: 'Ala', role: 'owner', created_at: at(start), deleted_at: null });
    const members = [me];
    const kids: string[] = [];
    if (g === 1)
      for (const [k, name] of ['Jan', 'Ola', 'Tymek', 'Zosia'].entries()) {
        const m = uid();
        put('group_members', m, { member_id: m, group_id: id, user_id: k < 2 ? `u${k}` : null, display_name: name, role: k < 2 ? 'member' : 'child', created_at: at(start), deleted_at: null });
        members.push(m);
        if (k >= 2) kids.push(m);
      }
    const list = uid();
    const shop = uid();
    put('lists', list, { id: list, group_id: id, kind: 'tasks', name: 'Dom', visibility: 'group', owner_member_id: null, sort_key: 'a0', deleted_at: null });
    put('lists', shop, { id: shop, group_id: id, kind: 'shopping', name: 'Zakupy', visibility: 'group', owner_member_id: null, sort_key: 'a1', deleted_at: null });
    groups.push({ id, me, kids, members, list, shop });
  }
  const fam = groups[1]!;
  const event = (row: Row, parts: string[]) => {
    const id = uid();
    put('events', id, { id, group_id: fam.id, note: null, location: null, audience: 'group', responsible_member_id: null, deleted_at: null, ...row });
    for (const m of parts) {
      const p = uid();
      put('event_participants', p, { id: p, group_id: fam.id, event_id: id, member_id: m, deleted_at: null });
    }
  };
  const WD = ['MO', 'TU', 'WE', 'TH', 'FR'];
  for (const kid of fam.kids)
    for (let l = 0; l < 25; l++) {
      const h = String(8 + (l % 6)).padStart(2, '0');
      event({ title: `Lekcja ${l}`, start_date: iso(start + (l % 5)), start_time: `${h}:00:00`, end_time: `${h}:45:00`, rrule: `FREQ=WEEKLY;BYDAY=${WD[l % 5]}`, kind: 'lesson', audience: 'members' }, [kid]);
    }
  for (let r = 0; r < 3; r++) event({ title: `Rutyna ${r}`, start_date: iso(start), start_time: '07:00:00', end_time: '07:30:00', rrule: 'FREQ=DAILY', kind: 'routine' }, []);
  for (let w = 0; w < 15; w++) event({ title: `Zajęcia ${w}`, start_date: iso(start + (w % 7)), start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY', kind: 'event' }, [fam.members[Math.floor(rnd() * fam.members.length)]!]);
  for (let d = start; d < 60; d += 3) event({ title: `Termin ${d}`, start_date: iso(d), start_time: '12:00:00', end_time: '13:00:00', rrule: null, kind: 'event' }, []);
  const task = (id: string, row: Row) =>
    put('tasks', id, { id, group_id: fam.id, parent_id: null, note: null, sort_key: 'a', start_date: null, event_id: null, occurrence_date: null, series_id: null, deleted_at: null, ...row });
  const chain: string[] = [];
  for (let d = start; d <= 0; d++) {
    for (let r = 0; r < 5; r++) {
      const id = (chain[r] = chain[r] ? nextId(chain[r]!) : uid());
      task(id, { list_id: fam.list, title: `Codzienne ${r}`, assignee_member_id: fam.me, deadline_mode: 'own', due_date: iso(d), due_time: '08:00:00', rollover: false, repeat: 'FREQ=DAILY', completed_at: d < 0 ? at(d) : null });
    }
    if (d % 7 === 0)
      for (let k = 0; k < 25; k++) {
        const shop = k >= 10;
        task(uid(), { list_id: shop ? fam.shop : fam.list, title: `Sprawa ${d}/${k}`, assignee_member_id: null, deadline_mode: shop ? 'none' : 'own', due_date: shop ? null : iso(d + 2), due_time: null, rollover: true, completed_at: d < -7 ? at(d + 2) : null });
      }
    for (let a = 0; a < 8 && d >= -90; a++) {
      const id = uid();
      put('activity', id, { id, group_id: fam.id, scope_id: fam.list, entity: 'tasks', entity_id: 'x', actor_member_id: null, action: 'update', created_at: at(d) });
    }
  }
  return t;
}
