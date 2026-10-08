/** Bramka testów bazy (db-gate.ts, audyt 2): bez PGHOST w CI_DB=1 błąd zamiast pominięcia; każdy plik z niej korzysta. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { dbEnabled } from './db-gate';

describe('bramka testów bazy', () => {
  it('PGHOST — testy biegną; bez PGHOST — pomijane; CI_DB=1 bez PGHOST — błąd', () => {
    expect(dbEnabled({ PGHOST: '/tmp' })).toBe(true);
    expect(dbEnabled({ PGHOST: '/tmp', CI_DB: '1' })).toBe(true);
    expect(dbEnabled({})).toBe(false);
    expect(dbEnabled({ CI_DB: '0' })).toBe(false);
    expect(() => dbEnabled({ CI_DB: '1' })).toThrow('CI_DB=1, ale brak PGHOST');
  });

  it('każdy test w tests/db używa bramki, nikt nie pomija testów sam', () => {
    const dir = join(__dirname);
    const files = readdirSync(dir).filter((f) => f.endsWith('.test.ts') && f !== 'db-gate.test.ts');
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect([f, src.includes("from './db-gate'")]).toEqual([f, true]);
      expect([f, /\b(describe|it|test)\.skip\b|process\.env\.PGHOST/.test(src)]).toEqual([f, false]);
    }
  });

  it('npm run test:db (także w db.yml) ustawia CI_DB=1', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['test:db']).toContain('CI_DB=1');
  });
});
