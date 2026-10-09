import type { Row } from '../sync-engine/client';
import { emptyForm } from '../views/event-form';
import { choicesError, groupGone, liveMember, namesOf, sanitizeEventDraft, sanitizeListDraft, sanitizeRoutineDraft, sanitizeTaskDraft } from '../views/form-choices';
import type { TaskForm } from '../views/task-form';

const ME = 'u-me';
const today = { y: 2026, m: 10, d: 8 };
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);

function base(): T {
  const t: T = {};
  const g = (id: string, name: string, kind = 'shared') => put(t, 'groups', id, { id, name, kind, created_at: '2026-01-01T00:00:00Z', deleted_at: null });
  g(ME, 'Osobiste', 'personal');
  g('gf', 'Rodzina');
  g('gk', 'Klasa 2b');
  g('gc', 'Babcia');
  const m = (id: string, gid: string, user: string | null, name: string, role = 'member', deleted: string | null = null) => put(t, 'group_members', id, { member_id: id, group_id: gid, user_id: user, display_name: name, role, deleted_at: deleted });
  m(ME, ME, ME, 'Łukasz', 'owner');
  m('mf', 'gf', ME, 'Łukasz', 'admin');
  m('ala', 'gf', 'u-ala', 'Ala', 'owner');
  m('tymek', 'gf', null, 'Tymek', 'child');
  m('ola', 'gf', 'u-ola', 'Ola', 'member', '2026-10-07T09:00:00Z');
  m('mk', 'gk', ME, 'Łukasz', 'member', '2026-10-07T09:00:00Z');
  m('mc', 'gc', ME, 'Łukasz', 'child');
  return t;
}
const task = (o: Partial<TaskForm> = {}): TaskForm => ({ title: '', groupId: ME, date: '', time: '', assigneeId: null, repeat: null, ...o });

describe('wybory formularza, których już nie ma (audyt 3, N-32)', () => {
  it('grupa: usunięto mnie, jestem dzieckiem, nie ma jej; osoba: żywa, w tej grupie, dorosła', () => {
    const t = base();
    expect(groupGone(t, ME, 'gf')).toBe(false);
    expect(groupGone(t, ME, 'gk')).toBe(true);
    expect(groupGone(t, ME, 'gc')).toBe(true);
    expect(groupGone(t, ME, 'brak')).toBe(true);
    expect(liveMember(t, 'gf', 'ala')).toBe(true);
    expect(liveMember(t, 'gf', 'tymek')).toBe(true);
    expect(liveMember(t, 'gf', 'tymek', { adult: true })).toBe(false);
    expect(liveMember(t, 'gf', 'ola')).toBe(false);
    expect(liveMember(t, 'gk', 'ala')).toBe(false);
    expect(liveMember(t, 'gf', 'brak')).toBe(false);
    expect(liveMember({}, 'gf', 'ala')).toBe(false);
    expect(namesOf(t, ['ola', 'brak', 'ala'])).toEqual(['Ola', 'Ala']);
    expect(namesOf({}, ['ola'])).toEqual([]);
  });

  it('szkic zadania: grupa wraca do wartości z otwarcia (razem z osobą), osoba usunięta — nikt, dzień miniony — bez terminu', () => {
    const t = base();
    const init = task({ groupId: ME });
    expect(sanitizeTaskDraft(t, ME, today, { title: 'Basen', groupId: 'gk', assigneeId: 'kx' }, init)).toEqual({ changes: { title: 'Basen' }, notices: [{ kind: 'group', name: 'Klasa 2b' }] });
    expect(sanitizeTaskDraft(t, ME, today, { groupId: 'zniknęła' }, init).notices).toEqual([{ kind: 'group', name: null }]);
    expect(sanitizeTaskDraft(t, ME, today, { groupId: 'gf', assigneeId: 'ola' }, init)).toEqual({ changes: { groupId: 'gf', assigneeId: null }, notices: [{ kind: 'people', names: ['Ola'] }] });
    // Osoba z grupy z otwarcia (szkic bez zmiany grupy).
    expect(sanitizeTaskDraft(t, ME, today, { assigneeId: 'ala' }, task({ groupId: 'gf' }))).toEqual({ changes: { assigneeId: 'ala' }, notices: [] });
    expect(sanitizeTaskDraft(t, ME, today, { assigneeId: null }, init)).toEqual({ changes: { assigneeId: null }, notices: [] });
    expect(sanitizeTaskDraft(t, ME, today, { date: '2026-10-07', time: '10:00', repeat: { kind: 'daily' } }, init)).toEqual({ changes: { date: '', time: '', repeat: null }, notices: [{ kind: 'date' }] });
    expect(sanitizeTaskDraft(t, ME, today, { date: '2026-10-08' }, init)).toEqual({ changes: { date: '2026-10-08' }, notices: [] });
    expect(sanitizeTaskDraft(t, ME, today, { date: '' }, init)).toEqual({ changes: { date: '' }, notices: [] });
  });

  it('szkic wydarzenia: nowe — grupa, uczestnicy, osoba odpowiedzialna (dorosła), dzień; zmiana — dzień zostaje', () => {
    const t = base();
    const init = { ...emptyForm('2026-10-08'), groupId: 'gf' };
    expect(sanitizeEventDraft(t, ME, today, { groupId: 'gk', participantIds: ['x'], responsibleId: 'x', title: 'A' }, init, true)).toEqual({ changes: { title: 'A' }, notices: [{ kind: 'group', name: 'Klasa 2b' }] });
    expect(sanitizeEventDraft(t, ME, today, { participantIds: ['ala', 'ola'], responsibleId: 'ola' }, init, true)).toEqual({ changes: { participantIds: ['ala'], responsibleId: null }, notices: [{ kind: 'people', names: ['Ola'] }] });
    expect(sanitizeEventDraft(t, ME, today, { responsibleId: 'tymek' }, init, true)).toEqual({ changes: { responsibleId: null }, notices: [{ kind: 'people', names: ['Tymek'] }] });
    expect(sanitizeEventDraft(t, ME, today, { participantIds: ['tymek'], responsibleId: null }, init, true)).toEqual({ changes: { participantIds: ['tymek'], responsibleId: null }, notices: [] });
    expect(sanitizeEventDraft(t, ME, today, { date: '2026-10-01', endDate: '2026-10-02' }, init, true)).toEqual({ changes: {}, notices: [{ kind: 'date' }] });
    expect(sanitizeEventDraft(t, ME, today, { date: '2026-10-01', groupId: 'gk' }, init, false)).toEqual({ changes: { date: '2026-10-01', groupId: 'gk' }, notices: [] });
  });

  it('szkic wydarzenia: grupa i dzień z parametrów otwarcia wygrywają (N-146); inna grupa — bez jej osób, bez napisu', () => {
    const t = base();
    const init = { ...emptyForm('2026-10-09'), groupId: 'gf' };
    expect(sanitizeEventDraft(t, ME, today, { groupId: ME, participantIds: [ME], responsibleId: ME, date: '2026-10-20', endDate: '2026-10-21', title: 'A' }, init, true, { groupId: 'gf', date: '2026-10-09' })).toEqual({ changes: { title: 'A' }, notices: [] });
    expect(sanitizeEventDraft(t, ME, today, { groupId: 'gf', participantIds: ['ala'] }, init, true, { groupId: 'gf' })).toEqual({ changes: { participantIds: ['ala'] }, notices: [] });
    expect(sanitizeEventDraft(t, ME, today, { date: '2026-10-09', endDate: '2026-10-10' }, init, true, { date: '2026-10-09' })).toEqual({ changes: { endDate: '2026-10-10' }, notices: [] });
    expect(sanitizeEventDraft(t, ME, today, { endDate: '2026-10-10' }, init, true, { date: '2026-10-09' })).toEqual({ changes: { endDate: '2026-10-10' }, notices: [] });
  });

  it('szkic rutyny: grupa (z osobami), osoby; grupa z parametru wygrywa', () => {
    const t = base();
    const init = { groupId: 'gf', who: [] as string[], title: '' };
    expect(sanitizeRoutineDraft(t, ME, { groupId: 'gk', who: ['x'], title: 'P' }, init)).toEqual({ changes: { title: 'P' }, notices: [{ kind: 'group', name: 'Klasa 2b' }] });
    expect(sanitizeRoutineDraft(t, ME, { who: ['tymek', 'ola'] }, init)).toEqual({ changes: { who: ['tymek'] }, notices: [{ kind: 'people', names: ['Ola'] }] });
    expect(sanitizeRoutineDraft(t, ME, { title: 'P' }, init)).toEqual({ changes: { title: 'P' }, notices: [] });
    expect(sanitizeRoutineDraft(t, ME, { groupId: ME, who: [ME] }, init, { groupId: 'gf' })).toEqual({ changes: {}, notices: [] });
    expect(sanitizeRoutineDraft(t, ME, { groupId: 'gf', who: ['ala'] }, init, { groupId: 'gf' })).toEqual({ changes: { who: ['ala'] }, notices: [] });
  });

  it('szkic nowej listy: parametry otwarcia, grupa, osoba robiąca zakupy (dorosła), miniony dzień zakupów', () => {
    const t = base();
    const init: { groupId: string; kind: 'tasks' | 'shopping'; name: string; trip: { date: string; time: string; responsibleId: string | null } } = { groupId: 'gf', kind: 'tasks', name: '', trip: { date: '', time: '', responsibleId: null } };
    expect(sanitizeListDraft(t, ME, today, { name: 'A', groupId: 'gk', kind: 'shopping' }, init, { kind: 'tasks' })).toEqual({ changes: { name: 'A' }, notices: [{ kind: 'group', name: 'Klasa 2b' }] });
    expect(sanitizeListDraft(t, ME, today, { groupId: ME, trip: { date: '', time: '', responsibleId: ME } }, init, { groupId: 'gf' })).toEqual({ changes: { trip: { date: '', time: '', responsibleId: null } }, notices: [] });
    expect(sanitizeListDraft(t, ME, today, { groupId: 'gf' }, init, { groupId: 'gf' })).toEqual({ changes: {}, notices: [] });
    expect(sanitizeListDraft(t, ME, today, { trip: { date: '2026-10-07', time: '10:00', responsibleId: 'tymek' } }, init)).toEqual({ changes: { trip: { date: '', time: '', responsibleId: null } }, notices: [{ kind: 'people', names: ['Tymek'] }, { kind: 'date' }] });
    expect(sanitizeListDraft(t, ME, today, { trip: { date: '2026-10-08', time: '', responsibleId: 'ala' } }, init)).toEqual({ changes: { trip: { date: '2026-10-08', time: '', responsibleId: 'ala' } }, notices: [] });
  });

  it('przy „Zapisz”: grupa, osoby i dorośli spoza grupy; osoby, które rzecz już miała, nie blokują', () => {
    const t = base();
    expect(choicesError(t, ME, { groupId: 'gk' })).toEqual({ error: 'group' });
    expect(choicesError(t, ME, { groupId: 'gk', checkGroup: false })).toBeNull();
    expect(choicesError(t, ME, { groupId: 'gf', people: ['ala', 'ola'], adults: ['tymek'] })).toEqual({ error: 'people', names: ['Ola', 'Tymek'] });
    expect(choicesError(t, ME, { groupId: 'gf', people: ['ola'], adults: ['ola'] })).toEqual({ error: 'people', names: ['Ola'] });
    expect(choicesError(t, ME, { groupId: 'gf', people: ['ola'], known: ['ola'] })).toBeNull();
    expect(choicesError(t, ME, { groupId: 'gf', people: ['ala'], adults: ['ala'] })).toBeNull();
  });
});
