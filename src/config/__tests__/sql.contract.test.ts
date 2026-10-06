/**
 * Test kontraktowy: liczby egzekwowane przez serwer (funkcje private.* w migracjach SQL) muszą być równe
 * wartościom z src/config — jedynego źródła prawdy. Zmiana w jednym miejscu bez drugiego zatrzymuje CI.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { config } from '../index';

const dir = join(__dirname, '../../../supabase/migrations');
const sql = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(dir, f), 'utf8'))
  .join('\n');

/** Wartość z definicji „create function private.<nazwa>() … as $$ select <liczba> $$”. */
function sqlConstant(name: string): number {
  const re = new RegExp(`create (?:or replace )?function private\\.${name}\\(\\)[^$]*\\$\\$\\s*select\\s+(\\d+)\\s*\\$\\$`, 'gi');
  const found = [...sql.matchAll(re)].map((m) => Number(m[1]));
  if (found.length === 0) throw new Error(`Brak funkcji private.${name}() w migracjach`);
  return found[found.length - 1]!; // obowiązuje ostatnia definicja
}

describe('src/config zgodny z SQL', () => {
  it.each([
    ['max_task_depth', config.MAX_TASK_DEPTH],
    ['push_batch_max', config.sync.PUSH_BATCH_MAX],
    ['pull_limit_max', config.sync.PULL_LIMIT_MAX],
    ['tombstone_days', config.sync.TOMBSTONE_DAYS],
    ['schema_version', config.sync.SCHEMA_VERSION],
  ])('private.%s() = %d', (name, value) => {
    expect(sqlConstant(name)).toBe(value);
  });

  it('brak definicji zgłaszany wprost', () => {
    expect(() => sqlConstant('nie_istnieje')).toThrow('Brak funkcji');
  });
});
