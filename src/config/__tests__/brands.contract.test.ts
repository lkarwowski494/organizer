/**
 * Nazwy innych firm i aplikacji (decyzja właściciela 9.10.2026, ADR 0043; App Review 2.3.7, 5.2.1, 2.3.10:
 * https://developer.apple.com/app-store/review/guidelines/): nie używamy ich w kodzie, komentarzach, tekstach
 * aplikacji, danych ani w dokumentacji pisanej przez nas. Wyjątki: nazwy platformy Apple (iPhone, kalendarz iPhone’a,
 * Mapy Apple, iCloud, „Zaloguj się przez Apple”), adresy źródeł (usuwane przed sprawdzeniem) i identyfikatory paczek
 * (np. @expo-google-fonts/… — nazwa zależności, nie nasz tekst). Pliki, które muszą zostać, są niżej z powodem.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const root = join(__dirname, '../../..');

/** Marki i aplikacje (początek słowa, bez względu na wielkość liter — łapie też odmianę: „Outlooka”, „Androidzie”). */
const BRANDS = [
  'google', 'gmail', 'outlook', 'microsoft', 'hotmail', 'android', 'samsung', 'huawei', 'whatsapp', 'messenger', 'facebook',
  'instagram', 'telegram', 'waze', 'yanosik', 'jakdojade', 'todoist', 'trello', 'evernote', 'ticktick', 'wunderlist',
  'familywall', 'timetree', 'listonic', 'anylist', 'ourgroceries', 'cozi', 'zoom', 'skype', 'slack', 'dropbox', 'yahoo',
  'biedronk', 'lidl', 'rossmann', 'auchan', 'carrefour', 'kaufland', 'frisco', 'żabk', 'lewiatan', 'stokrotk', 'tesco',
  'ikea', 'castorama', 'allegro',
];
const WORDS = ['exchange', 'aldi', 'netto', 'dino'];
const PATTERN = new RegExp(`(?<![\\p{L}\\d_])(?:${BRANDS.join('|')})[\\p{L}]*|(?<![\\p{L}\\d_])(?:${WORDS.join('|')})(?![\\p{L}\\d_])`, 'giu');

/** Katalogi i pliki sprawdzane w całości (wszystko, co piszemy sami). */
const SCANNED = ['src', 'e2e', '.maestro', 'scripts', 'modules', 'site', 'supabase', 'docs', 'tests', '.github', 'fastlane', 'app.json', 'App.tsx', 'index.ts', 'jest.app-setup.js', 'jest.app-after-env.js', 'jest.config.js', 'jest.mutation.config.js', 'stryker.config.json', 'stryker.shard.config.mjs', 'babel.config.js', 'tsconfig.json', 'package.json', 'README.md', 'AGENTS.md', 'Gemfile', '.gitleaksignore', '.claude', 'eslint.config.js', '.gitignore', '.gitleaks.toml'];
const SKIP_DIRS = new Set(['node_modules', '.temp', '.branches']);
const TEXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.sql', '.yaml', '.yml', '.toml', '.sh', '.swift', '.rb', '.podspec', '.html', '.css', '.txt', '.py', '.snap', '.xml', '.plist', '.csv', '']);

/** Pliki, w których nazwa musi zostać — z powodem (sprawdzane: każdy wpis jest potrzebny). */
const ALLOWED: Record<string, string> = {
  // Istniejących migracji nie zmieniamy (CLAUDE.md, migracje już na produkcji); komentarze stare, nowe pliki są sprawdzane.
  'supabase/migrations/20261007090000_invites.sql': 'migracja na produkcji',
  'supabase/migrations/20261008250000_join_codes.sql': 'migracja na produkcji',
  // Szablon konfiguracji z narzędzia wiersza poleceń Supabase: lista dostawców logowania w komentarzach.
  'supabase/config.toml': 'szablon narzędzia',
  // Reguła gitleaks na prywatne adresy e-mail musi wymienić domeny dostawców poczty; skrypt testuje ją takim adresem.
  '.gitleaks.toml': 'domeny poczty w regule personal-email',
  '.github/scripts/test-gitleaks-rules.sh': 'próbka dla reguły personal-email',
  // Katalog natywny generowany przez `expo prebuild` (nie trafia do repozytorium) — ścieżka, nie nazwa w tekście.
  'eslint.config.js': 'ścieżka katalogu z prebuild',
  '.gitignore': 'ścieżka katalogu z prebuild',
  // Decyzja o nazwach innych firm wymienia odrzucone warianty i usuniętą opcję z nazwy.
  'docs/adr/0043-nazwy-innych-firm.md': 'zapis decyzji',
  // Ten test.
  'src/config/__tests__/brands.contract.test.ts': 'lista sprawdzanych nazw',
};

/**
 * Pojedyncze wystąpienia, które muszą zostać (dokładna lista — nowe wystąpienie w tym pliku oblewa test): wartość,
 * którą buildy 21–22 zapisały na telefonach przy wyborze innych map — test sprawdza, że nie psuje „Nawiguj”.
 */
const ALLOWED_HITS: Record<string, string[]> = {
  'src/app/__tests__/account-prefs.test.ts': ['google', 'google'],
  'src/app/__tests__/travel.screens.test.tsx': ['google'],
};

function files(p: string): string[] {
  const abs = join(root, p);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return [];
  }
  if (st.isFile()) return TEXT.has(extname(p)) ? [p] : [];
  return readdirSync(abs).filter((n) => !SKIP_DIRS.has(n)).flatMap((n) => files(join(p, n)));
}

/** Adresy źródeł i identyfikatory paczek nie są naszym tekstem. */
const strip = (s: string) =>
  s
    .replace(/https?:\/\/[^\s)'"`>\]]+/g, ' ')
    .replace(/@[a-z0-9-]+\\?\/[a-z0-9./\\-]*/gi, ' ');

function brandHits(text: string): string[] {
  return [...strip(text).matchAll(PATTERN)].map((m) => m[0]);
}

describe('bez nazw innych firm i aplikacji (ADR 0043)', () => {
  it('wzorzec: łapie odmianę i wielkość liter, pomija adresy, paczki i wyjątki Apple', () => {
    expect(brandHits('także Google i Outlooka; na Androidzie; GMAIL; jak w Zoom; Lista „Biedronka”')).toEqual(['Google', 'Outlooka', 'Androidzie', 'GMAIL', 'Zoom', 'Biedronka']);
    expect(brandHits('(https://github.com/google/fonts/blob/main/ofl/OFL.txt) @expo-google-fonts/bricolage-grotesque/700Bold')).toEqual([]);
    expect(brandHits('Mapy Apple, kalendarz iPhone’a, iCloud, „Zaloguj się przez Apple”; exchangeCode, kardynał, Dinozaur')).toEqual([]);
  });

  it('teksty aplikacji, kod, komentarze, dane, testy i dokumentacja', () => {
    const all = SCANNED.flatMap(files);
    expect(all.length).toBeGreaterThan(300);
    const hits = all
      .filter((f) => !(f in ALLOWED))
      .flatMap((f) => {
        const found = brandHits(readFileSync(join(root, f), 'utf8'));
        return JSON.stringify(found) === JSON.stringify(ALLOWED_HITS[f] ?? []) ? [] : found.map((h) => `${f}: ${h}`);
      });
    expect(hits).toEqual([]);
    expect(Object.keys(ALLOWED_HITS).filter((f) => !all.includes(f))).toEqual([]);
  });

  it('każdy wyjątek jest nadal potrzebny', () => {
    const unused = Object.keys(ALLOWED).filter((f) => brandHits(readFileSync(join(root, f), 'utf8')).length === 0);
    expect(unused).toEqual([]);
  });
});
