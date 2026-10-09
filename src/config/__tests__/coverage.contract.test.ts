/**
 * Czysta logika pod progiem 100% (audyt 2, M-51): plik .ts w src/app, src/features albo src/ui bez Reacta, React Native,
 * modułów Expo i nawigacji (także pośrednio przez kontekst aplikacji, src/ui i pliki .tsx) to logika jak w src/domain —
 * musi mieć w jest.config.js próg 100% (albo zostać przeniesiony do src/domain, gdzie próg i testy mutacyjne są
 * z automatu). Nowy taki plik bez progu oblewa CI.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = join(__dirname, '../../..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jestConfig = require(join(root, 'jest.config.js')) as { coverageThreshold: { [path: string]: { lines: number; branches: number; functions: number; statements: number } } };

const PLATFORM = /from '(react|react-native|expo|expo-[\w-]+|@expo\/[\w/-]+|@react-navigation\/[\w-]+|@supabase\/[\w-]+|@react-native-community\/[\w-]+|react-native-[\w-]+)(\/[\w/.-]+)?'/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : files(p);
    return [p];
  });
}

/** Plik zależy od platformy (bezpośrednio albo przez lokalny moduł .tsx, src/ui lub kontekst aplikacji). */
function platformBound(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  if (file.endsWith('.tsx')) return true;
  // Same typy (import type) nie wiążą z platformą.
  const src = readFileSync(file, 'utf8').split('\n').filter((l) => !/^import type /.test(l)).join('\n');
  if (PLATFORM.test(src)) return true;
  for (const m of src.matchAll(/from '(\.{1,2}\/[^']+)'/g)) {
    const base = resolve(dirname(file), m[1]!);
    const target = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((e) => base + e).find(existsSync);
    if (!target || target.includes(`${join(root, 'src/domain')}`) || target.includes(join(root, 'src/config')) || target.includes(join(root, 'src/i18n'))) continue;
    if (platformBound(target, seen)) return true;
  }
  return false;
}

describe('czysta logika w warstwach aplikacji ma próg 100% (M-51)', () => {
  const pure = ['src/app', 'src/features', 'src/ui']
    .flatMap((d) => files(join(root, d)))
    // Same typy (bez kodu wykonywalnego, np. routes.ts) nie mają czego pokrywać.
    .filter((f) => f.endsWith('.ts') && /^export (async )?(function|const|class|let)\b/m.test(readFileSync(f, 'utf8')) && !platformBound(f))
    .map((f) => relative(root, f));

  it('wykrywa znane pliki czystej logiki (próba sanity)', () => {
    expect(pure).toEqual(expect.arrayContaining(['src/app/self-check.ts', 'src/features/groups/server-errors.ts']));
    expect(pure).not.toContain('src/app/added.ts'); // hak Reacta przez src/ui/undo
    expect(pure).not.toContain('src/app/calendar-mirror.ts'); // przez device-calendar (expo-calendar); próg 100% i tak ma
  });

  it.each([['każdy plik czystej logiki']])('%s ma w jest.config.js próg 100%', () => {
    const missing = pure.filter((f) => {
      const t = jestConfig.coverageThreshold[`./${f}`];
      return !t || [t.lines, t.branches, t.functions, t.statements].some((x) => x !== 100);
    });
    expect(missing).toEqual([]);
  });
});
