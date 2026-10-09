/**
 * Zasady plików tests/db bez bazy: bramka (db-gate.ts, audyt 2) — bez PGHOST w CI_DB=1 błąd zamiast pominięcia, każdy
 * plik z niej korzysta; rozłączne identyfikatory plików (niżej).
 */
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

/**
 * Pliki tests/db biegną równolegle na jednej bazie, każdy w swoich transakcjach. Dwa pliki ze wspólnym kluczem (to samo
 * konto w auth.users, ta sama grupa) czekają na siebie przy każdym wstawieniu, aż drugi zatwierdzi albo wycofa
 * transakcję — tak fake-vs-sql i phones-vs-sql (te same konta i grupa) szły na zmianę i fake-vs-sql przekraczał
 * limit czasu (pomiar 9.10.2026: ~80% próbek pg_stat_activity z oczekiwaniem na blokadę to wstawienie konta).
 * Kontrakt: pierwszy człon identyfikatorów (przestrzeń pliku) należy do jednego pliku, a konta (00000000-…) i każdy
 * pełny identyfikator wpisany wprost występują tylko w jednym pliku. Przestrzenie z danych pgTAP (rules-vs-sql czyta
 * role_matrix_all.test.sql: 88888888) też liczą się do pliku, który je czyta.
 */
const DIR = __dirname;
const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));

/** Pierwsze człony identyfikatorów (bez kont 00000000) i pełne identyfikatory wpisane wprost, per plik. */
function scan(f: string) {
  const src = readFileSync(join(DIR, f), 'utf8');
  // Dane wczytane z pgTAP: ich przestrzenie należą do pliku, który je wczytuje (konta rules-vs-sql podmienia na swoje,
  // więc pełne identyfikatory liczą się tylko z samego pliku).
  const reads = [...src.matchAll(/supabase\/tests\/([\w.]+\.sql)/g)].map((m) => readFileSync(join(DIR, '../../supabase/tests', m[1]!), 'utf8'));
  const spaces = new Set([src, ...reads].flatMap((t) => [...t.matchAll(/\b([0-9a-f]{8})-[0-9a-f]{4}-7[0-9a-f]{3}-/g)].map((m) => m[1]!)).filter((s) => s !== '00000000'));
  const full = new Set([...src.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g)].map((m) => m[0]));
  return { spaces, full };
}

describe('identyfikatory testów bazy: każdy plik w swojej przestrzeni', () => {
  const scans = Object.fromEntries(files.map((f) => [f, scan(f)]));

  it('pierwszy człon identyfikatorów należy do jednego pliku', () => {
    const owners: { [space: string]: string[] } = {};
    for (const [f, s] of Object.entries(scans)) for (const sp of s.spaces) (owners[sp] ??= []).push(f);
    expect(Object.entries(owners).filter(([, fs]) => fs.length > 1)).toEqual([]);
    // Pilnuje, że skan coś widzi (np. fake-vs-sql i phones-vs-sql mają swoje przestrzenie).
    expect(Object.keys(owners).length).toBeGreaterThanOrEqual(7);
  });

  it('konta i inne pełne identyfikatory wpisane wprost występują tylko w jednym pliku', () => {
    const owners: { [uuid: string]: string[] } = {};
    for (const [f, s] of Object.entries(scans)) for (const u of s.full) (owners[u] ??= []).push(f);
    expect(Object.entries(owners).filter(([, fs]) => fs.length > 1)).toEqual([]);
  });
});
