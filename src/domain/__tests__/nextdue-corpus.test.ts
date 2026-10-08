/**
 * Następny termin zadania powtarzanego — korpus z niezależnej implementacji (python-dateutil, scripts/gen-nextdue-corpus.py;
 * audyt 2, Q-21). Obejmuje 29–31. dzień w lutym i w roku przestępnym, wykonanie przed terminem, zaległe i interwały 10, 14, 99.
 */
import { parseIsoDate } from '../format';
import { formatRepeat, nextDue, type Repeat } from '../views/task-repeat';
import corpus from './fixtures/nextdue.json';

type Case = { repeat: Repeat; rule: string; due: string; done: string; next: string };
const cases = corpus as Case[];
const iso = (c: { y: number; m: number; d: number }) => `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;

describe('nextDue = python-dateutil', () => {
  it('korpus jest pełny', () => {
    expect(cases.length).toBeGreaterThan(400);
  });

  it('zapis reguły jak w generatorze', () => {
    for (const c of cases) expect(formatRepeat(c.repeat)).toBe(c.rule);
  });

  it('każdy przypadek', () => {
    const differ = cases.filter((c) => iso(nextDue(c.repeat, parseIsoDate(c.due), parseIsoDate(c.done))) !== c.next);
    expect(differ).toEqual([]);
  });
});
