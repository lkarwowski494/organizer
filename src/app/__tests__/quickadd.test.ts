/**
 * Szybkie dodawanie na warstwie zapisu (quickAddOps): tekst → operacje → wiersz po materialize.
 * Korpus parsera (oczekiwania z niezależnej implementacji w Pythonie) przechodzi całą drogę zapisu (audyt 2, Q-3),
 * a na liście zakupów tytuł zostaje dosłowny (audyt 2, M-20).
 */
import corpus from '../../domain/__tests__/fixtures/quickadd.pl.json';
import type { LocalDateTime } from '../../domain/civil-date';
import { parseQuickAdd } from '../../domain/quickadd';
import { initialState, materialize, mutate, type NewOp, type Row } from '../../domain/sync-engine/client';
import { strings } from '../../i18n/strings.pl';
import { quickAddOps } from '../quickadd';

const ME = 'u-me';
const NOW: LocalDateTime = { y: 2026, m: 10, d: 8, hh: 12, mm: 0 };
const at = (iso: string): LocalDateTime => {
  const [date, time] = iso.split('T') as [string, string];
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return { y, m, d, hh, mm };
};

function tables(): Record<string, Record<string, Row>> {
  const list = (id: string, kind: string) => ({ id, group_id: ME, kind, name: id, visibility: 'group', owner_member_id: null, sort_key: 'a0', deleted_at: null, version: 1 });
  return {
    groups: { [ME]: { id: ME, name: 'Osobiste', kind: 'personal', created_at: '2026-01-01T00:00:00Z', deleted_at: null, version: 1 } },
    group_members: { [ME]: { member_id: ME, group_id: ME, user_id: ME, display_name: 'Łukasz', role: 'owner', deleted_at: null, version: 1 } },
    lists: { lp: list('lp', 'tasks'), lz: list('lz', 'shopping') },
  };
}

/** Wiersz zadania po zapisie tekstu na listę (stan telefonu po operacjach). */
function saved(text: string, listId: string, now = NOW): Row | undefined {
  let n = 0;
  const base = tables();
  const ops: NewOp[] = quickAddOps({ tables: base, userId: ME, text, now, ignore: [], newId: () => `id-${++n}`, listId });
  const st = ops.reduce((s, op) => mutate(s, op, () => `op-${++n}`), { ...initialState('c'), base });
  return Object.values(materialize(st).tasks ?? {})[0];
}

describe('lista zakupów: bez rozpoznawania terminów (M-20)', () => {
  it.each([
    'mąka 1.5 kg',
    'mleko 1.5',
    'mleko 3.2',
    'cukier 1.1',
    'mleko 2/3',
    'pizza 18.00',
    'baton o 7',
    'kurczak o 2 kg',
    'sok na sobotę',
    'chleb jutro',
    'jogurt co tydzień',
  ])('„%s” zostaje nazwą, bez terminu i powtarzania', (text) => {
    expect(saved(text, 'lz')).toMatchObject({ title: text, deadline_mode: 'none', due_date: null, due_time: null });
    expect(saved(text, 'lz')).not.toHaveProperty('repeat');
  });

  it('spacje złączone, puste nic nie dodaje', () => {
    expect(saved('  mąka   1.5 kg ', 'lz')).toMatchObject({ title: 'mąka 1.5 kg' });
    expect(saved('   ', 'lz')).toBeUndefined();
  });

  it('lista zadań nadal rozpoznaje termin', () => {
    expect(saved('pranie w sobotę', 'lp')).toMatchObject({ title: 'pranie', deadline_mode: 'own', due_date: '2026-10-10' });
  });
});

describe('korpus parsera na warstwie zapisu (lista zadań)', () => {
  it.each(corpus.map((c) => [`${c.now} | ${c.text}`, c] as const))('%s', (_, c) => {
    const row = saved(c.text, 'lp', at(c.now))!;
    const due = c.expected.due;
    expect({ title: row.title, date: row.due_date, time: row.due_time, repeat: row.repeat ?? null }).toEqual({
      title: c.expected.title,
      date: due?.date ?? null,
      time: due?.time ?? null,
      repeat: c.expected.rrule,
    });
  });
});

describe('przykłady w aplikacji działają (audyt 2, M-23)', () => {
  // Frazy w cudzysłowach „…”.
  const quoted = (text: string) => [...text.matchAll(/„([^”]+)”/g)].map((m) => m[1]!);
  const examples = [strings['today.empty'], strings['quick.placeholder'], strings['welcome.2.example'], strings['lists.addTask']].flatMap(quoted);
  const hints = quoted(strings['quick.dayUnclear']('przyszły wtorek')).slice(1);

  it.each(examples)('przykład „%s” — nazwa i termin rozpoznane', (phrase) => {
    const r = parseQuickAdd(phrase, NOW);
    expect(r.title).not.toBe('');
    expect(r.due).not.toBeNull();
    expect(r.unrecognizedDay).toBeNull();
  });

  it.each(hints)('podpowiedź „%s” to sam rozpoznany termin', (phrase) => {
    expect(parseQuickAdd(phrase, NOW)).toMatchObject({ title: '', unrecognizedDay: null });
    expect(parseQuickAdd(phrase, NOW).due).not.toBeNull();
  });

  it('wszystkie przykłady w tekstach są sprawdzane', () => {
    expect(examples).toHaveLength(5);
    expect(hints).toEqual(['w piątek', 'jutro', '15.10']);
  });
});
