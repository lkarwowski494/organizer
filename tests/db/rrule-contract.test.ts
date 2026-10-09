/**
 * Kontrakt reguł powtarzania telefon ↔ serwer (audyt 2, M-190, Q-22; migracja 20261008485000_rrule_check): SQL przyjmuje
 * dokładnie te reguły, które telefon umie rozwinąć. Wydarzenia: private.rrule_ok ⇔ parseRule (src/domain/rrule.ts) nie
 * rzuca. Zadania: private.task_repeat_ok ⇔ parseRepeat (src/domain/views/task-repeat.ts) coś odczytuje. Zestaw: korpus
 * RRULE (fixtures/rrule.json), reguły szybkiego dodawania, każdy zapis z formularza powtarzania, lista reguł błędnych
 * z audytu i kilka tysięcy reguł losowych z tych samych klocków.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

import { formEventRules } from '../../src/domain/__tests__/support/form-rules';
import { formatRule, parseRule } from '../../src/domain/rrule';
import { formatRepeat, parseRepeat, type Repeat } from '../../src/domain/views/task-repeat';
import { dbDescribe } from './db-gate';

const d = dbDescribe;
const DB = process.env.PGDATABASE ?? 'organizer_test';

const fixtures = join(__dirname, '../../src/domain/__tests__/fixtures');
const corpus = (JSON.parse(readFileSync(join(fixtures, 'rrule.json'), 'utf8')) as { rule: string }[]).map((c) => c.rule);
const quickadd = (JSON.parse(readFileSync(join(fixtures, 'quickadd.pl.json'), 'utf8')) as { expected: { rrule: string | null } | null }[])
  .map((c) => c.expected?.rrule)
  .filter((r): r is string => typeof r === 'string');

const repeats: Repeat[] = [
  { kind: 'daily' },
  { kind: 'monthly' },
  ...Array.from({ length: 31 }, (_, i): Repeat => ({ kind: 'monthly', day: i + 1 })),
  { kind: 'monthly', day: -1 },
  // Każdy niepusty podzbiór dni tygodnia.
  ...Array.from({ length: 127 }, (_, mask): Repeat => ({ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6].filter((b) => ((mask + 1) >> b) & 1) })),
  ...(['DAILY', 'WEEKLY'] as const).flatMap((unit) => Array.from({ length: 99 }, (_, i): Repeat => ({ kind: 'after', unit, interval: i + 1 }))),
];

const BAD = [
  'FREQ=DAILY;INTERVAL=0', 'FREQ=DAILY;COUNT=0', 'FREQ=DAILY;INTERVAL=5;INTERVAL=7', 'FREQ=WEEKLY;BYDAY=XX,,', 'FREQ=DAILY;UNTIL=99999999T999999Z',
  'FREQ=DAILY;INTERVAL=1000000', 'FREQ=DAILY;INTERVAL=100', 'FREQ=DAILY;UNTIL=20260230', 'FREQ=DAILY;COUNT=3;UNTIL=20261010', 'FREQ=DAILY;BYDAY=MO',
  'FREQ=WEEKLY;BYDAY=1MO', 'FREQ=MONTHLY;BYDAY=6MO', 'FREQ=MONTHLY;BYMONTHDAY=0', 'FREQ=MONTHLY;BYMONTHDAY=32', 'FREQ=MONTHLY;BYMONTHDAY=-0',
  'FREQ=MONTHLY;BYDAY=MO;BYMONTHDAY=1', 'FREQ=WEEKLY;BYMONTHDAY=1', 'FREQ=WEEKLY;WKST=SU', 'FREQ=HOURLY', 'INTERVAL=2', '', 'FREQ=DAILY;', 'FREQ=DAILY;X=1',
  'FREQ=DAILY;INTERVAL=', 'FREQ=WEEKLY;BYDAY=', 'FREQ=DAILY;COUNT=1001', 'FREQ', 'FREQ=DAILY=WEEKLY', 'freq=daily', 'FREQ=YEARLY;BYDAY=MO',
];
const GOOD = ['FREQ=MONTHLY;BYDAY=-1FR', 'FREQ=DAILY;COUNT=1000', 'INTERVAL=2;FREQ=WEEKLY', 'FREQ=DAILY;UNTIL=00000101', 'FREQ=DAILY;UNTIL=20280229', 'FREQ=WEEKLY;WKST=MO;BYDAY=MO,MO'];

/** Reguły losowe z klocków (deterministyczne, LCG), także błędne. */
function random(n: number): string[] {
  let s = 20261008;
  const next = (k: number) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s % k;
  };
  const pick = <T,>(xs: readonly T[]) => xs[next(xs.length)]!;
  const keys = ['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'COUNT', 'UNTIL', 'WKST', 'X'];
  const values: Record<string, string[]> = {
    FREQ: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'HOURLY', ''],
    INTERVAL: ['0', '1', '2', '7', '14', '99', '100', '01', '-1', ''],
    BYDAY: ['MO', 'MO,TH', '1MO', '-1FR', '+2SU', '5SA', '6MO', 'XX', 'MO,,TU', ''],
    BYMONTHDAY: ['1', '15', '31', '-1', '-31', '0', '32', '1,15', '1,,2', ''],
    COUNT: ['0', '1', '10', '1000', '1001', ''],
    UNTIL: ['20261231', '20260230', '20240229', '20230229', '2026123', '20261231T000000Z', ''],
    WKST: ['MO', 'SU', ''],
    X: ['1'],
  };
  return Array.from({ length: n }, () => {
    const parts = Array.from({ length: 1 + next(4) }, () => {
      const k = pick(keys);
      return `${k}=${pick(values[k]!)}`;
    });
    if (next(3) > 0) parts.unshift(`FREQ=${pick(values.FREQ!)}`);
    return parts.join(';');
  });
}

const phoneAccepts = (r: string) => {
  try {
    parseRule(r);
    return true;
  } catch {
    return false;
  }
};

d('reguły powtarzania: telefon = serwer (M-190)', () => {
  let db: Client;
  beforeAll(async () => {
    db = new Client({ database: DB });
    await db.connect();
  });
  afterAll(() => db.end());

  const check = async (fn: 'rrule_ok' | 'task_repeat_ok', rules: string[]) => {
    const rows = (await db.query(`select r, private.${fn}(r) ok from unnest($1::text[]) r`, [rules])).rows as { r: string; ok: boolean }[];
    return new Map(rows.map((x) => [x.r, x.ok]));
  };

  it('wydarzenia: korpus, szybkie dodawanie, formularz, błędne i losowe', async () => {
    const formatted = [...corpus, ...quickadd].map((r) => formatRule(parseRule(r)));
    const rules = [...new Set([...corpus, ...quickadd, ...formatted, ...formEventRules(), ...BAD, ...GOOD, ...random(4000)])];
    const sql = await check('rrule_ok', rules);
    const differ = rules.filter((r) => sql.get(r) !== phoneAccepts(r));
    expect(differ).toEqual([]);
    // Zestaw zawiera i przyjęte, i odrzucone (test nie jest pusty po żadnej stronie).
    for (const r of [...corpus, ...GOOD, ...formEventRules()]) expect(sql.get(r)).toBe(true);
    for (const r of BAD) expect(sql.get(r)).toBe(false);
  });

  it('zadania: każdy zapis z formularza i to samo zestawienie co wyżej', async () => {
    const written = repeats.map(formatRepeat);
    const rules = [...new Set([...written, ...corpus, ...quickadd, ...BAD, ...GOOD, ...random(2000), 'AFTER=DAILY;INTERVAL=0', 'AFTER=WEEKLY;INTERVAL=100', 'AFTER=MONTHLY;INTERVAL=2'])];
    const sql = await check('task_repeat_ok', rules);
    expect(rules.filter((r) => sql.get(r) !== (parseRepeat(r) !== null))).toEqual([]);
    for (const r of written) expect(sql.get(r)).toBe(true);
  });
});
