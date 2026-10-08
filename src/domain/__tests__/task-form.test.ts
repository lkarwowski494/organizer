import type { Row } from '../sync-engine/client';
import { formFromTask, formFromText, formGroups, formMembers, formOps, formUnseen, formWeekday, generalList, movedSubtasks, NEW_LIST_NAME, PERSONAL_LIST_NAME, type TaskForm, validateForm } from '../views/task-form';

const ME = 'u-me';
const NOW = { y: 2026, m: 10, d: 8, hh: 10, mm: 0 };
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);

function base(): T {
  const t: T = {};
  const g = (id: string, name: string, kind: string, created: string) => put(t, 'groups', id, { id, name, kind, created_at: created, deleted_at: null });
  g(ME, 'Osobiste', 'personal', '2026-01-01T00:00:00Z');
  g('gf', 'Rodzina', 'shared', '2026-02-01T00:00:00Z');
  g('gk', 'Klasa', 'shared', '2026-03-01T00:00:00Z');
  g('gc', 'Babcia', 'shared', '2026-04-01T00:00:00Z');
  const m = (id: string, gid: string, user: string | null, name: string, role = 'member', deleted: string | null = null) =>
    put(t, 'group_members', id, { member_id: id, group_id: gid, user_id: user, display_name: name, role, deleted_at: deleted });
  m(ME, ME, ME, 'Łukasz', 'owner');
  m('mf', 'gf', ME, 'Łukasz', 'admin');
  m('ala', 'gf', 'u-ala', 'Ala', 'owner');
  m('kuba', 'gf', null, 'Kuba', 'child');
  m('old', 'gf', 'u-old', 'Ola', 'member', 'x');
  m('mk', 'gk', ME, 'Łukasz');
  m('alicja', 'gk', 'u-al', 'Alicja');
  m('mc', 'gc', ME, 'Łukasz', 'child');
  const l = (id: string, gid: string, kind = 'tasks', name = id) => put(t, 'lists', id, { id, group_id: gid, kind, name, visibility: 'group', sort_key: 'a0', deleted_at: null });
  l('lp', ME);
  l('lf', 'gf', 'tasks', 'Balet – Róża');
  l('lf2', 'gf', 'tasks', 'Zadania');
  l('lz', 'gf', 'shopping', 'Zadania');
  put(t, 'tasks', 't1', { id: 't1', group_id: ME, list_id: 'lp', parent_id: null, title: 'Basen', note: 'czepek', sort_key: 'a0', assignee_member_id: null, deadline_mode: 'own', due_date: '2026-10-09', due_time: '19:00:00', repeat: null, completed_at: null, deleted_at: null });
  put(t, 'tasks', 't2', { id: 't2', group_id: 'gf', list_id: 'lf', parent_id: null, title: 'Śmieci', note: null, sort_key: 'a0', assignee_member_id: 'ala', deadline_mode: 'none', due_date: null, due_time: null, repeat: 'FREQ=WEEKLY;BYDAY=MO', completed_at: null, deleted_at: null });
  return t;
}

const form = (over: Partial<TaskForm> = {}): TaskForm => ({ title: 'Basen', groupId: ME, listId: null, date: '2026-10-09', time: '19:00', assigneeId: null, repeat: null, ...over });

describe('pełny formularz zadania (D90)', () => {
  it('grupy (bez tych, gdzie jestem dzieckiem), osoby bez usuniętych', () => {
    const t = base();
    expect(formGroups(t, ME).map((g) => g.id)).toEqual([ME, 'gf', 'gk']);
    expect(formMembers(t, 'gf').map((m) => m.display_name)).toEqual(['Ala', 'Kuba', 'Łukasz']);
    put(t, 'group_members', 'nn', { member_id: 'nn', group_id: 'gk', user_id: 'u-n', deleted_at: null });
    expect(formMembers(t, 'gk').map((m) => m.display_name)).toEqual(['', 'Alicja', 'Łukasz']);
    expect(formMembers({}, 'gk')).toEqual([]);
  });

  it('z tekstu: termin, „co tydzień” i @imię z jednym dopasowaniem', () => {
    const t = base();
    expect(formFromText(t, ME, 'Basen jutro 19.00', NOW)).toEqual({ form: form(), candidates: [] });
    expect(formFromText(t, ME, 'Basen jutro 19.00 @ala', NOW).form).toEqual(form({ groupId: 'gf', assigneeId: 'ala' }));
    expect(formFromText(t, ME, 'basen w piątek co tydzień', NOW).form).toMatchObject({ date: '2026-10-09', time: '', repeat: { kind: 'weekly', days: [4] } });
    expect(formFromText(t, ME, 'basen co tydzień', NOW).form).toMatchObject({ date: '2026-10-08', repeat: { kind: 'weekly', days: [3] } });
  });

  it('@imię: kilka dopasowań — kandydaci, nic nie ustawione; brak dopasowania — @ zostaje w nazwie', () => {
    const t = base();
    const r = formFromText(t, ME, 'zebranie @al', NOW);
    expect(r.candidates.map((c) => c.memberId)).toEqual(['ala', 'alicja']);
    expect(r.form).toMatchObject({ title: 'zebranie', groupId: ME, assigneeId: null });
    expect(formFromText(t, ME, 'zebranie @zenek', NOW)).toMatchObject({ form: { title: 'zebranie @zenek' }, candidates: [] });
    expect(formFromText({}, ME, 'x', NOW).form.groupId).toBe('');
  });

  it('z zadania; nieznane zadanie; termin nie „własny” → pusty', () => {
    const t = base();
    expect(formFromTask(t, 't1')).toEqual({ title: 'Basen', groupId: ME, listId: 'lp', date: '2026-10-09', time: '19:00', assigneeId: null, repeat: null });
    expect(formFromTask(t, 't2')).toEqual({ title: 'Śmieci', groupId: 'gf', listId: 'lf', date: '', time: '', assigneeId: 'ala', repeat: { kind: 'weekly', days: [0] } });
    put(t, 'tasks', 't3', { ...t.tasks!.t1!, id: 't3', due_time: null });
    expect(formFromTask(t, 't3')!.time).toBe('');
    // Termin bez godziny bez zmian — brak operacji.
    expect(formOps(t, ME, form({ listId: 'lp', time: '' }), () => 'x', 't3').ops).toEqual([]);
    expect(formFromTask(t, 'brak')).toBeNull();
  });

  it('walidacja: nazwa, grupa, data, godzina, powtarzanie bez daty, adresat we wspólnej grupie', () => {
    const t = base();
    const v = (o: Partial<TaskForm>) => validateForm(t, ME, form(o));
    expect(v({})).toBeNull();
    expect(v({ title: '  ' })).toBe('title');
    expect(v({ groupId: 'gc' })).toBe('group');
    expect(v({ date: '2026-02-30' })).toBe('date');
    expect(v({ date: 'jutro' })).toBe('date');
    expect(v({ time: '25:00' })).toBe('time');
    expect(v({ date: '', time: '10:00' })).toBe('date');
    expect(v({ date: '', time: '', repeat: { kind: 'daily' } })).toBe('repeatNeedsDate');
    // D68 po decyzji właściciela z 8.10.2026 (PW-18 b): „kiedyś, ktokolwiek” we wspólnej grupie da się zapisać.
    expect(v({ groupId: 'gf', date: '', time: '' })).toBeNull();
    expect(v({ groupId: 'gf', date: '', time: '', assigneeId: 'ala' })).toBeNull();
    expect(v({ date: '', time: '' })).toBeNull();
    // Audyt 2 (T-15): osoba usunięta z grupy (D132) albo nieznana to „nikt konkretny” — od PW-18 b bez blokady,
    // za to z dopiskiem (formUnseen niżej).
    expect(v({ groupId: 'gf', date: '', time: '', assigneeId: 'old' })).toBeNull();
    expect(formUnseen(t, ME, form({ groupId: 'gf', date: '', time: '', assigneeId: 'old' }))).toBe(true);
    expect(formUnseen(t, ME, form({ groupId: 'gf', assigneeId: 'old' }))).toBe(false);
  });

  it('PW-18 b: dopisek „nikt tego nie widzi” tylko we wspólnej grupie, bez żywej osoby i bez terminu; lista „Tylko ja” poza regułą', () => {
    const t = base();
    const u = (o: Partial<TaskForm>) => formUnseen(t, ME, form(o));
    expect(u({ groupId: 'gf', date: '', time: '' })).toBe(true);
    expect(u({ groupId: 'gf', date: '', time: '', assigneeId: 'ala' })).toBe(false);
    expect(u({ groupId: 'gf' })).toBe(false); // z terminem
    expect(u({ date: '', time: '' })).toBe(false); // grupa osobista
    expect(u({ groupId: 'nie-ma', date: '' })).toBe(false);
    // Osoba usunięta z grupy albo nieznana to nikt konkretny (D132).
    put(t, 'group_members', 'byla', { member_id: 'byla', group_id: 'gf', user_id: null, display_name: 'Była', role: 'member', deleted_at: '2026-10-01T00:00:00Z' });
    expect(u({ groupId: 'gf', date: '', assigneeId: 'byla' })).toBe(true);
    expect(u({ groupId: 'gf', date: '', assigneeId: 'nieznana' })).toBe(true);
    // Zadanie zostaje na mojej liście „Tylko ja” w tej samej grupie — poza regułą; po zmianie grupy już nie.
    put(t, 'lists', 'lprv', { id: 'lprv', group_id: 'gf', kind: 'tasks', name: 'Prezenty', visibility: 'private', deleted_at: null });
    expect(u({ groupId: 'gf', date: '', listId: 'lprv' })).toBe(false);
    expect(u({ groupId: 'gf', date: '', listId: 'nie-ma' })).toBe(true);
    put(t, 'lists', 'lprv2', { id: 'lprv2', group_id: 'gp', kind: 'tasks', name: 'Moje tajne', visibility: 'private', deleted_at: null });
    expect(u({ groupId: 'gf', date: '', listId: 'lprv2' })).toBe(true);
    put(t, 'lists', 'lgrp', { id: 'lgrp', group_id: 'gf', kind: 'tasks', name: 'Dom', visibility: 'group', deleted_at: null });
    expect(u({ groupId: 'gf', date: '', listId: 'lgrp' })).toBe(true);
  });

  it('dzień tygodnia do edytora powtarzania: z daty albo dzisiejszy', () => {
    expect(formWeekday(form(), { y: 2026, m: 10, d: 8 })).toBe(4);
    expect(formWeekday(form({ date: '' }), { y: 2026, m: 10, d: 8 })).toBe(3);
    expect(formWeekday(form({ date: '2026-13-01' }), { y: 2026, m: 10, d: 8 })).toBe(3);
  });

  it('ogólna lista grupy (D97): osobista — pierwsza lista zadań; wspólna — „Zadania” (nie tematyczna, nie zakupy); brak — nowa', () => {
    const t = base();
    const id = () => 'nl';
    expect(generalList(t, ME, ME, id)).toEqual({ listId: 'lp', ops: [] });
    expect(generalList(t, ME, 'gf', id)).toEqual({ listId: 'lf2', ops: [] });
    expect(generalList(t, ME, 'gk', id)).toEqual({ listId: 'nl', ops: [{ kind: 'create', entity: 'lists', id: 'nl', group_id: 'gk', set: { kind: 'tasks', name: NEW_LIST_NAME, visibility: 'group' } }] });
    delete t.lists!.lp;
    expect(generalList(t, ME, ME, id).ops[0]).toMatchObject({ group_id: ME, set: { name: PERSONAL_LIST_NAME } });
  });

  it('nowe: ogólna lista grupy, osoba, powtarzanie; grupa bez listy — nowa lista', () => {
    const t = base();
    let n = 0;
    const id = () => `n${++n}`;
    const r = formOps(t, ME, form({ groupId: 'gf', assigneeId: 'ala', repeat: { kind: 'daily' } }), id);
    expect(r.taskId).toBe('n1');
    expect(r.ops).toEqual([
      { kind: 'create', entity: 'tasks', id: 'n1', group_id: 'gf', set: { list_id: 'lf2', parent_id: null, title: 'Basen', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-09', due_time: '19:00', assignee_member_id: 'ala' } },
      { kind: 'patch', entity: 'tasks', id: 'n1', set: { repeat: 'FREQ=DAILY' } },
    ]);
    expect(formOps(t, ME, form({ groupId: 'gf', time: '' }), id).ops[0]).toMatchObject({ set: { list_id: 'lf2', due_time: null } });
    const g = formOps(t, ME, form({ groupId: 'gk', date: '' }), id);
    expect(g.ops[0]).toEqual({ kind: 'create', entity: 'lists', id: 'n3', group_id: 'gk', set: { kind: 'tasks', name: NEW_LIST_NAME, visibility: 'group' } });
    expect(g.ops[1]).toMatchObject({ kind: 'create', id: 'n4', set: { list_id: 'n3', deadline_mode: 'none', due_date: null } });
  });

  it('„Zmień” w tej samej grupie: tylko zmienione pola, zadanie zostaje na swojej liście', () => {
    const t = base();
    const id = () => 'x';
    expect(formOps(t, ME, form({ listId: 'lp' }), id, 't1')).toEqual({ ops: [], taskId: 't1' });
    expect(formOps(t, ME, form({ listId: 'lp', title: 'Basen z Kubą', time: '18:00', repeat: { kind: 'weekly', days: [4] } }), id, 't1').ops).toEqual([
      { kind: 'patch', entity: 'tasks', id: 't1', set: { title: 'Basen z Kubą' } },
      { kind: 'patch', entity: 'tasks', id: 't1', set: { deadline_mode: 'own', due_date: '2026-10-09', due_time: '18:00' } },
      { kind: 'patch', entity: 'tasks', id: 't1', set: { repeat: 'FREQ=WEEKLY;BYDAY=FR' } },
    ]);
    expect(formOps(t, ME, form({ groupId: 'gf', listId: 'lf', title: 'Śmieci', date: '', time: '', assigneeId: null, repeat: { kind: 'weekly', days: [0] } }), id, 't2').ops).toEqual([
      { kind: 'patch', entity: 'tasks', id: 't2', set: { assignee_member_id: null } },
    ]);
    expect(formOps(t, ME, form({ groupId: 'gf', listId: 'lf', title: 'Śmieci', date: '2026-10-12', time: '', assigneeId: 'ala', repeat: { kind: 'weekly', days: [0] } }), id, 't2').ops).toEqual([
      { kind: 'patch', entity: 'tasks', id: 't2', set: { deadline_mode: 'own', due_date: '2026-10-12', due_time: null } },
    ]);
  });

  it('„Zmień” na inną grupę: kopia z notatką w nowej grupie, oryginał do kosza', () => {
    const t = base();
    const r = formOps(t, ME, form({ groupId: 'gf', assigneeId: 'ala' }), () => 'copy', 't1');
    expect(r.taskId).toBe('copy');
    expect(r.ops).toEqual([
      { kind: 'create', entity: 'tasks', id: 'copy', group_id: 'gf', set: { list_id: 'lf2', parent_id: null, title: 'Basen', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-09', due_time: '19:00', assignee_member_id: 'ala' } },
      { kind: 'patch', entity: 'tasks', id: 'copy', set: { note: 'czepek' } },
      { kind: 'delete', entity: 'tasks', id: 't1' },
    ]);
    expect(formOps(t, ME, form({ groupId: ME, title: 'Śmieci', date: '', time: '' }), () => 'c2', 't2').ops.map((o) => o.kind)).toEqual(['create', 'delete']);
  });

  it('audyt 2 (T-33): ile podzadań pójdzie do kosza z oryginałem przy zmianie grupy (wszystkie żywe poziomy)', () => {
    const t = base();
    const sub = (id: string, parent: string, deleted: string | null = null) => put(t, 'tasks', id, { ...t.tasks!.t1!, id, parent_id: parent, title: id, deadline_mode: 'inherit', due_date: null, due_time: null, deleted_at: deleted });
    expect(movedSubtasks(t, 't1')).toBe(0);
    sub('s1', 't1');
    sub('s2', 't1');
    sub('s3', 't1', 'x'); // już w koszu — nie liczy się (i jego podzadania też nie)
    sub('s11', 's1');
    sub('s31', 's3');
    expect(movedSubtasks(t, 't1')).toBe(3);
    expect(movedSubtasks(t, 'nie-ma')).toBe(0);
  });
});
