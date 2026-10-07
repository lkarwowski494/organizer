/** Kontrakt: kroje ładowane w App.tsx = nazwy używane przez motyw (src/ui/theme.tsx). Brak kroju = tekst systemowy. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = readFileSync(join(__dirname, '../../../App.tsx'), 'utf8');
const theme = readFileSync(join(__dirname, '../../ui/theme.tsx'), 'utf8');

it('każdy krój z motywu jest ładowany i żaden ładowany nie jest zbędny', () => {
  const used = [...theme.matchAll(/'((?:BricolageGrotesque|AtkinsonHyperlegibleNext)_\w+)'/g)].map((m) => m[1]).sort();
  const loaded = [...app.matchAll(/import \{ (\w+) \} from '@expo-google-fonts\/[\w-]+\/(\w+)'/g)].map((m) => m[1]).sort();
  expect(used.length).toBe(5);
  expect(loaded).toEqual(used);
  for (const f of loaded) expect(app).toMatch(new RegExp(`^\\s+${f},$`, 'm'));
});
