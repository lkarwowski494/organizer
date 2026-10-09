import { config } from '../../config';
import type { Row } from '../sync-engine/client';
import { formDate, formFromText, formGroups, formMembers, formOps, formUnseen, generalList, NEW_LIST_NAME, PERSONAL_LIST_NAME, pickCandidate, type TaskForm, validateForm } from '../views/task-form';

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
  m('tymek', 'gf', null, 'Tymek', 'child');
  m('old', 'gf', 'u-old', 'Ola', 'member', 'x');
  m('mk', 'gk', ME, 'Łukasz');
  m('alicja', 'gk', 'u-al', 'Alicja');
  m('mc', 'gc', ME, 'Łukasz', 'child');
  const l = (id: string, gid: string, kind = 'tasks', name = id) => put(t, 'lists', id, { id, group_id: gid, kind, name, visibility: 'group', sort_key: 'a0', deleted_at: null });
  l('lp', ME);
  l('lf', 'gf', 'tasks', 'Szachy – Zosia');
  l('lf2', 'gf', 'tasks', 'Zadania');
  l('lz', 'gf', 'shopping', 'Zadania');
  put(t, 'tasks', 't1', { id: 't1', group_id: ME, list_id: 'lp', parent_id: null, title: 'Basen', note: 'czepek', sort_key: 'a0', assignee_member_id: null, deadline_mode: 'own', due_date: '2026-10-09', due_time: '19:00:00', repeat: null, completed_at: null, deleted_at: null });
  put(t, 'tasks', 't2', { id: 't2', group_id: 'gf', list_id: 'lf', parent_id: null, title: 'Śmieci', note: null, sort_key: 'a0', assignee_member_id: 'ala', deadline_mode: 'none', due_date: null, due_time: null, repeat: 'FREQ=WEEKLY;BYDAY=MO', completed_at: null, deleted_at: null });
  return t;
}

const form = (over: Partial<TaskForm> = {}): TaskForm => ({ title: 'Basen', groupId: ME, date: '2026-10-09', time: '19:00', assigneeId: null, repeat: null, ...over });

describe('pełny formularz zadania (D90)', () => {
  it('grupy (bez tych, gdzie jestem dzieckiem), osoby bez usuniętych', () => {
    const t = base();
    expect(formGroups(t, ME).map((g) => g.id)).toEqual([ME, 'gf', 'gk']);
    expect(formMembers(t, 'gf').map((m) => m.display_name)).toEqual(['Ala', 'Łukasz', 'Tymek']);
    put(t, 'group_members', 'nn', { member_id: 'nn', group_id: 'gk', user_id: 'u-n', deleted_at: null });
    expect(formMembers(t, 'gk').map((m) => m.display_name)).toEqual(['', 'Alicja', 'Łukasz']);
    expect(formMembers({}, 'gk')).toEqual([]);
  });

  it('z tekstu: termin, „co tydzień” i @imię z jednym dopasowaniem', () => {
    const t = base();
    expect(formFromText(t, ME, 'Basen jutro 19.00', NOW)).toEqual({ form: form(), candidates: [], mention: null });
    expect(formFromText(t, ME, 'Basen jutro 19.00 @ala', NOW).form).toEqual(form({ groupId: 'gf', assigneeId: 'ala' }));
    expect(formFromText(t, ME, 'basen w piątek co tydzień', NOW).form).toMatchObject({ date: '2026-10-09', time: '', repeat: { kind: 'weekly', days: [4] } });
    expect(formFromText(t, ME, 'basen co tydzień', NOW).form).toMatchObject({ date: '2026-10-08', repeat: { kind: 'weekly', days: [3] } });
  });

  it('@imię: kilka dopasowań — kandydaci, „@al” w nazwie do wyboru (audyt 2, M-170); brak dopasowania — @ zostaje w nazwie', () => {
    const t = base();
    const r = formFromText(t, ME, 'zebranie jutro @al', NOW);
    expect(r.candidates.map((c) => c.memberId)).toEqual(['ala', 'alicja']);
    expect(r.mention).toBe('al');
    expect(r.form).toMatchObject({ title: 'zebranie @al', groupId: ME, assigneeId: null, date: '2026-10-09' });
    expect(pickCandidate(r.form, 'al', r.candidates[1]!)).toEqual({ ...r.form, title: 'zebranie', groupId: 'gk', assigneeId: 'alicja' });
    // Nazwa zmieniona przed wyborem: „@al” znika tylko, jeśli jeszcze jest; interpunkcja bez wiszącej spacji.
    expect(pickCandidate({ ...r.form, title: 'zebranie @al, sala 4' }, 'al', r.candidates[0]!).title).toBe('zebranie, sala 4');
    expect(pickCandidate({ ...r.form, title: 'zebranie' }, 'al', r.candidates[0]!).title).toBe('zebranie');
    expect(formFromText(t, ME, 'zebranie @zenek', NOW)).toMatchObject({ form: { title: 'zebranie @zenek' }, candidates: [], mention: null });
    expect(formFromText({}, ME, 'x', NOW).form.groupId).toBe('');
  });

  it('„#Grupa”, „@ja” i grupa z chipa jak przy „+” (audyt 2, M-24); „#…” bez jednej grupy zostaje w nazwie', () => {
    const t = base();
    expect(formFromText(t, ME, 'zebranie #Klasa jutro @ja', NOW).form).toMatchObject({ title: 'zebranie', groupId: 'gk', assigneeId: 'mk', date: '2026-10-09' });
    expect(formFromText(t, ME, 'zebranie', NOW, { chipGroupId: 'gf' }).form).toMatchObject({ groupId: 'gf', assigneeId: null });
    expect(formFromText(t, ME, 'bilety #kino', NOW, { chipGroupId: 'gf' }).form).toMatchObject({ title: 'bilety #kino', groupId: 'gf' });
    expect(formFromText(t, ME, '#osob basen', NOW, { chipGroupId: 'gf', personalLabel: 'Osobiste' }).form).toMatchObject({ title: 'basen', groupId: ME });
    put(t, 'groups', 'gr', { id: 'gr', name: 'Rodzice', kind: 'shared', created_at: '2026-05-01T00:00:00Z', deleted_at: null });
    put(t, 'group_members', 'mr', { member_id: 'mr', group_id: 'gr', user_id: ME, display_name: 'Łukasz', role: 'member', deleted_at: null });
    // Kilka grup na „#rodz” — grupę wybierzesz w formularzu; dalej „@al” z kilkoma osobami — kandydaci.
    expect(formFromText(t, ME, 'zebranie #rodz @al', NOW)).toMatchObject({ form: { title: 'zebranie #rodz @al', groupId: ME }, mention: 'al', candidates: [{ memberId: 'ala' }, { memberId: 'alicja' }] });
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
    // Audyt 2 (T-15): osoba usunięta z grupy (D132) albo nieznana to „nikt konkretny” — dopisek (formUnseen niżej).
    // Audyt 3 (N-32): zapis z nią serwer odrzuca (invalid_assignee) — formularz mówi o tym przed wysłaniem.
    expect(v({ groupId: 'gf', date: '', time: '', assigneeId: 'old' })).toBe('assignee');
    expect(v({ groupId: 'gf', assigneeId: 'nieznana' })).toBe('assignee');
    expect(v({ groupId: 'gf', assigneeId: 'alicja' })).toBe('assignee');
    expect(v({ groupId: 'gf', assigneeId: 'tymek' })).toBeNull();
    // Audyt 3 (N-134): nazwa do config.lengths.TASK_TITLE znaków (CHECK char_length — emoji to jeden znak).
    expect(v({ title: 'x'.repeat(config.lengths.TASK_TITLE) })).toBeNull();
    expect(v({ title: '😀'.repeat(config.lengths.TASK_TITLE) })).toBeNull();
    expect(v({ title: 'x'.repeat(config.lengths.TASK_TITLE + 1) })).toBe('titleLong');
    expect(formUnseen(t, ME, form({ groupId: 'gf', date: '', time: '', assigneeId: 'old' }))).toBe(true);
    expect(formUnseen(t, ME, form({ groupId: 'gf', assigneeId: 'old' }))).toBe(false);
  });

  it('PW-18 b: dopisek „nikt tego nie widzi” tylko we wspólnej grupie, bez żywej osoby i bez terminu', () => {
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
  });

  it('data do edytora powtarzania: z formularza albo dzisiejsza', () => {
    const today = { y: 2026, m: 10, d: 8 };
    expect(formDate(form(), today)).toEqual({ y: 2026, m: 10, d: 9 });
    expect(formDate(form({ date: '' }), today)).toEqual(today);
    expect(formDate(form({ date: '2026-13-01' }), today)).toEqual(today);
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
});
