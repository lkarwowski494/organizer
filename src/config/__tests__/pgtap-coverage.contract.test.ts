/**
 * Test statyczny reguły D47 (audyt 2, M-154 / Q-11): każdy kod odrzucenia z `raise exception` w OSTATNICH definicjach
 * funkcji (migracje w kolejności nazw, późniejsza definicja zastępuje wcześniejszą) występuje w testach pgTAP
 * (supabase/tests), a każda funkcja public.* ma tam test sukcesu (lives_ok / is / ok / results_eq … z wywołaniem).
 * Odrzucenie przez brak uprawnień funkcji tylko dla serwera pilnuje schema_contracts.test.sql (dokładna lista).
 * Kolejna migracja, która przepisze strażnika i doda kod bez testu — albo nową funkcję RPC bez testu — oblewa CI.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../..');
const migrations = readdirSync(join(root, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8'));
const tests = readdirSync(join(root, 'supabase/tests'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(root, 'supabase/tests', f), 'utf8'))
  .join('\n');

/** Ostatnie definicje funkcji: nazwa (schemat.nazwa) → treść między znacznikami $…$. */
function latestFunctions(files: readonly string[]): Map<string, string> {
  const defs = new Map<string, string>();
  for (const src of files) {
    const re = /create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+([\w."]+)\s*\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$/gi;
    const drop = /drop\s+(?:function|procedure)\s+(?:if\s+exists\s+)?([\w.]+)/gi;
    const events: { at: number; name: string; body?: string }[] = [];
    for (const m of src.matchAll(re)) events.push({ at: m.index, name: m[1]!.toLowerCase().replace(/"/g, ''), body: m[3]! });
    for (const m of src.matchAll(drop)) events.push({ at: m.index, name: m[1]!.toLowerCase() });
    for (const e of events.sort((a, b) => a.at - b.at)) {
      if (e.body === undefined) defs.delete(e.name);
      else defs.set(e.name, e.body);
    }
  }
  return defs;
}

/** Kody z `raise exception '<kod>'` (bez kodów składanych przez format: z %). */
function rejectionCodes(defs: Map<string, string>): Map<string, string[]> {
  const codes = new Map<string, string[]>();
  for (const [fn, body] of defs) {
    for (const m of body.matchAll(/raise\s+exception\s+'([^'%]+)'/gi)) codes.set(m[1]!, [...(codes.get(m[1]!) ?? []), fn]);
  }
  return codes;
}

describe('testy pgTAP pokrywają każdy kod odrzucenia i każdą funkcję RPC (D47)', () => {
  const defs = latestFunctions(migrations);
  const codes = rejectionCodes(defs);

  it('parser widzi definicje i kody (próba sanity: znane funkcje i kody)', () => {
    expect(defs.has('public.sync_push')).toBe(true);
    expect(defs.has('private.tasks_guard')).toBe(true);
    expect(codes.get('forbidden:child')?.length).toBeGreaterThan(0);
    expect(codes.size).toBeGreaterThan(50);
  });

  it('ostatnia definicja wygrywa, drop usuwa funkcję', () => {
    const a = "create function private.f() returns void language plpgsql as $$ begin raise exception 'stary'; end $$;";
    const b = "create or replace function private.f() returns void language plpgsql as $x$ begin raise exception 'nowy'; end $x$;";
    expect([...rejectionCodes(latestFunctions([a, b])).keys()]).toEqual(['nowy']);
    expect(latestFunctions([a, 'drop function if exists private.f;']).size).toBe(0);
    expect(latestFunctions([`${a}\ndrop function private.f;\n${b}`]).get('private.f')).toContain('nowy');
  });

  it('każdy kod odrzucenia występuje w supabase/tests', () => {
    const missing = [...codes].filter(([code]) => !tests.includes(`'${code}'`) && !tests.includes(`"${code}"`)).map(([code, fns]) => `${code} (${[...new Set(fns)].join(', ')})`);
    expect(missing).toEqual([]);
  });

  it('każda funkcja public.* ma w supabase/tests asercję z jej wywołaniem', () => {
    const publics = [...defs.keys()].filter((f) => f.startsWith('public.')).map((f) => f.slice('public.'.length));
    expect(publics.length).toBeGreaterThan(20);
    const missing = publics.filter((fn) => !new RegExp(`(lives_ok|is|isnt|ok|results_eq|is_empty|isnt_empty|set_eq|throws_ok)\\([^\\n]*\\b${fn}\\(`).test(tests));
    expect(missing).toEqual([]);
  });
});
