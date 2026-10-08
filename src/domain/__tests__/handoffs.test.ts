import { applyOp, type NewOp, type Op, type Row } from '../sync-engine/client';
import {
  asHandoff,
  cancelHandoff,
  closeHandoff,
  createHandoff,
  decideHandoff,
  declinedHandoffs,
  handoffKey,
  handoffsToNotify,
  handoffTargets,
  incomingHandoffs,
  outgoingPending,
} from '../views/handoffs';

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
let seq = 0;
const run = (t: T, ops: NewOp[]) => {
  for (const op of ops) applyOp(t, { ...op, seq: ++seq, op_id: `o${seq}` } as Op);
  return t;
};
function world(): T {
  const t: T = {};
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  const m = (id: string, user: string | null, name: string, role: string, extra: Row = {}) =>
    put(t, 'group_members', id, { member_id: id, group_id: 'gf', user_id: user, display_name: name, role, deleted_at: null, ...extra });
  m('mf', ME, 'Łukasz', 'admin');
  m('mm', 'u-m', 'Magdalena', 'owner');
  m('ma', 'u-a', 'Ala', 'member');
  m('kuba', null, 'Kuba', 'child');
  m('dawny', 'u-d', 'Dawny', 'member', { deleted_at: 'x' });
  put(t, 'tasks', 't1', { id: 't1', group_id: 'gf', list_id: 'l', title: 'Logopeda' });
  put(t, 'events', 'e1', { id: 'e1', group_id: 'gf', title: 'Tańce', start_date: '2026-10-05' });
  return t;
}

describe('przekazanie odpowiedzialności (D70)', () => {
  it('odczyt wiersza z wartościami domyślnymi', () => {
    expect(asHandoff({ id: 'h', group_id: 'g', entity: 'x', entity_id: 'e', to_member: 'm', status: 'zły' })).toEqual({
      id: 'h', group_id: 'g', entity: 'tasks', entity_id: 'e', occurrence_date: null, from_member: '', to_member: 'm', status: 'pending', closed: false,
    });
    expect(asHandoff({ id: 'h', group_id: 'g', entity: 'events', entity_id: 'e', occurrence_date: '2026-10-12', from_member: 'f', to_member: 'm', status: 'declined', closed: true })).toMatchObject({ entity: 'events', occurrence_date: '2026-10-12', status: 'declined', closed: true });
  });

  it('komu: dorośli z kontem, bez mnie, dzieci i usuniętych; po imieniu', () => {
    expect(handoffTargets(world(), ME, 'gf').map((m) => m.member_id)).toEqual(['ma', 'mm']);
    expect(handoffTargets(world(), ME, 'obca')).toEqual([]);
  });

  it('nowe moje przekazanie (przed wysłaniem bez nadawcy) czeka u mnie z imieniem odbiorcy; anulowanie', () => {
    const t = world();
    const op = createHandoff({ id: 'h1', groupId: 'gf', entity: 'tasks', entityId: 't1', toMember: 'mm' });
    expect(op).toEqual({ kind: 'create', entity: 'handoffs', id: 'h1', group_id: 'gf', set: { entity: 'tasks', entity_id: 't1', occurrence_date: null, to_member: 'mm' } });
    run(t, [op]);
    const out = outgoingPending(t, ME);
    expect(out.get(handoffKey('tasks', 't1', null))).toMatchObject({ otherName: 'Magdalena', title: 'Logopeda', groupName: 'Rodzina' });
    expect(incomingHandoffs(t, ME)).toEqual([]);
    run(t, [cancelHandoff('h1')]);
    expect(outgoingPending(t, ME).size).toBe(0);
    // Dwa terminy tej samej serii (ten sam tytuł) — stała kolejność po identyfikatorze.
    run(t, [
      createHandoff({ id: 'hb', groupId: 'gf', entity: 'events', entityId: 'e1', occurrenceDate: '2026-10-19', toMember: 'ma' }),
      createHandoff({ id: 'ha', groupId: 'gf', entity: 'events', entityId: 'e1', occurrenceDate: '2026-10-12', toMember: 'ma' }),
    ]);
    expect([...outgoingPending(t, ME).values()].map((h) => h.id)).toEqual(['ha', 'hb']);
  });

  it('do potwierdzenia u mnie: zadanie i termin wydarzenia; decyzja; odrzucone moje do zamknięcia', () => {
    const t = world();
    put(t, 'handoffs', 'h2', { id: 'h2', group_id: 'gf', entity: 'events', entity_id: 'e1', occurrence_date: '2026-10-12', from_member: 'mm', to_member: 'mf', status: 'pending' });
    put(t, 'handoffs', 'h3', { id: 'h3', group_id: 'gf', entity: 'tasks', entity_id: 't1', from_member: 'ma', to_member: 'mf', status: 'pending' });
    put(t, 'handoffs', 'h4', { id: 'h4', group_id: 'gf', entity: 'tasks', entity_id: 'nie-ma', from_member: 'mf', to_member: 'mm', status: 'declined' });
    put(t, 'handoffs', 'h7', { id: 'h7', group_id: 'gf', entity: 'events', entity_id: 'e1', from_member: 'mf', to_member: 'nieznany', status: 'declined' });
    put(t, 'handoffs', 'h5', { id: 'h5', group_id: 'gx', entity: 'tasks', entity_id: 't1', from_member: 'x', to_member: 'mf', status: 'pending' });
    expect(incomingHandoffs(t, ME).map((h) => [h.id, h.title, h.otherName])).toEqual([
      ['h3', 'Logopeda', 'Ala'],
      ['h2', 'Tańce', 'Magdalena'],
    ]);
    expect(declinedHandoffs(t, ME).map((h) => [h.id, h.title, h.otherName])).toEqual([['h4', '', 'Magdalena'], ['h7', 'Tańce', '']]);
    expect(decideHandoff('h2', true)).toEqual({ kind: 'patch', entity: 'handoffs', id: 'h2', set: { status: 'accepted' } });
    run(t, [decideHandoff('h3', false), closeHandoff('h4'), closeHandoff('h7')]);
    expect(incomingHandoffs(t, ME).map((h) => h.id)).toEqual(['h2']);
    expect(declinedHandoffs(t, ME)).toEqual([]);
    put(t, 'handoffs', 'h6', { id: 'h6', group_id: 'gf', entity: 'tasks', entity_id: 't1', from_member: 'mm', to_member: 'kuba', status: 'pending' });
    expect(incomingHandoffs(t, ME).map((h) => h.id)).toEqual(['h2']);
    expect(handoffKey('events', 'e1', '2026-10-12')).toBe('events|e1|2026-10-12');
  });

  it('osoba usunięta z grupy: jej przekazania nie czekają ani na mnie, ani na nią (audyt 2, R-34)', () => {
    const t = world();
    put(t, 'handoffs', 'od', { id: 'od', group_id: 'gf', entity: 'tasks', entity_id: 't1', from_member: 'dawny', to_member: 'mf', status: 'pending' });
    put(t, 'handoffs', 'do', { id: 'do', group_id: 'gf', entity: 'tasks', entity_id: 't1', from_member: 'mf', to_member: 'dawny', status: 'pending' });
    put(t, 'handoffs', 'odrz', { id: 'odrz', group_id: 'gf', entity: 'events', entity_id: 'e1', from_member: 'mf', to_member: 'dawny', status: 'declined' });
    put(t, 'handoffs', 'jest', { id: 'jest', group_id: 'gf', entity: 'events', entity_id: 'e1', from_member: 'ma', to_member: 'mf', status: 'pending' });
    expect(incomingHandoffs(t, ME).map((h) => h.id)).toEqual(['jest']);
    expect(outgoingPending(t, ME).size).toBe(0);
    expect(declinedHandoffs(t, ME)).toEqual([]);
  });
});

describe('o które przekazania poprosić o push (D70)', () => {
  it('moje nowe po potwierdzeniu serwera i moje decyzje; nie stare, nie anulowane, nie już wysłane', () => {
    const t = world();
    const NOW = Date.parse('2026-10-07T12:00:00Z');
    const h = (id: string, extra: Row) => put(t, 'handoffs', id, { id, group_id: 'gf', entity: 'tasks', entity_id: 't1', from_member: 'mf', to_member: 'mm', status: 'pending', created_at: '2026-10-07T11:00:00Z', push_sent_status: null, ...extra });
    h('a-new', {});
    h('b-local', { from_member: '', created_at: undefined });
    h('c-sent', { push_sent_status: 'pending' });
    h('d-old', { created_at: '2026-10-05T11:00:00Z' });
    h('e-theirs', { from_member: 'mm', to_member: 'mf' });
    h('f-decided', { from_member: 'mm', to_member: 'mf', status: 'accepted', decided_at: '2026-10-07T11:30:00Z', push_sent_status: 'pending' });
    h('g-local-decision', { from_member: 'mm', to_member: 'mf', status: 'declined', decided_at: null });
    h('h-their-decision', { status: 'declined', decided_at: '2026-10-07T11:30:00Z' });
    h('i-cancelled', { status: 'cancelled' });
    h('j-alien', { group_id: 'obca' });
    expect(handoffsToNotify(t, ME, NOW, 24)).toEqual(['a-new', 'f-decided']);
    expect(handoffsToNotify({}, ME, NOW, 24)).toEqual([]);
  });
});
