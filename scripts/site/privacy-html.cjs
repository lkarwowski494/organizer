#!/usr/bin/env node
// Strona polityki prywatności (audyt 3, N-75; decyzja właściciela Q4 A): site/privacy/index.html powstaje z jedynego
// źródła — docs/privacy-policy.md. Obsługuje tylko to, czego używa polityka: nagłówki #/##/###, akapity, listy „- ”
// (wcięcie 2 spacje = poziom niżej, dalszy ciąg punktu wcięty), **pogrubienie**, adresy https:// jako linki i komentarze
// HTML (pomijane — notatki dla zespołu). Bez zewnętrznych skryptów i stylów (jak strona zaproszeń /j/).
//   node scripts/site/privacy-html.cjs --write   # zapisuje site/privacy/index.html
// Zgodność pliku ze źródłem sprawdza src/config/__tests__/privacy-policy.contract.test.ts.
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Adres na końcu zdania: kropka i przecinek nie należą do adresu.
    .replace(/https:\/\/[^\s)<]+?(?=[.,;]?(?:\s|\)|$))/g, (u) => `<a href="${u}">${u}</a>`);

function render(md) {
  const lines = md.replace(/<!--[\s\S]*?-->\n?/g, '').split('\n');
  const out = [];
  let para = [];
  // Otwarte listy: wcięcie każdego poziomu; bieżący punkt na każdym poziomie zbiera tekst.
  const stack = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeTo = (depth) => {
    while (stack.length > depth) {
      const top = stack.pop();
      out.push(`${inline(top.text.join(' '))}${top.inner.join('')}</li>`);
      out.push('</ul>');
      if (stack.length) {
        // Zamknięta lista należy do punktu wyżej.
        const parent = stack[stack.length - 1];
        parent.inner.push(out.splice(top.start).join(''));
      }
    }
  };
  let title = '';
  for (const line of lines) {
    const item = /^( *)- (.*)$/.exec(line);
    if (item) {
      flushPara();
      const indent = item[1].length;
      const depth = indent / 2 + 1;
      if (depth > stack.length + 1) throw new Error(`zbyt głęboka lista: ${line}`);
      if (depth === stack.length + 1) {
        stack.push({ indent, start: out.length, text: [item[2]], inner: [] });
        out.push('<ul><li>');
        continue;
      }
      closeTo(depth);
      const top = stack[stack.length - 1];
      out.push(`${inline(top.text.join(' '))}${top.inner.join('')}</li><li>`);
      top.text = [item[2]];
      top.inner = [];
      continue;
    }
    if (stack.length && /^ {2,}\S/.test(line)) {
      stack[stack.length - 1].text.push(line.trim());
      continue;
    }
    closeTo(0);
    const h = /^(#{1,3}) (.*)$/.exec(line);
    if (h) {
      flushPara();
      if (h[1] === '#') title = h[2];
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (line.trim() === '') flushPara();
    else para.push(line.trim());
  }
  flushPara();
  closeTo(0);
  return [
    '<!doctype html>',
    '<html lang="pl">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    '<style>',
    '  :root { --ground: #f7f1e8; --ink: #2b211b; --muted: #6b5a4d; --accent: #b4532a; }',
    '  @media (prefers-color-scheme: dark) { :root { --ground: #1c1714; --ink: #f4ece2; --muted: #c4b3a3; --accent: #e07a4f; } }',
    '  body { margin: 0; background: var(--ground); color: var(--ink); font: 17px/1.5 -apple-system, system-ui, sans-serif; }',
    '  main { max-width: 680px; margin: 0 auto; padding: 32px 16px 48px; }',
    '  h1 { font-size: 28px; line-height: 1.2; } h2 { font-size: 22px; margin-top: 32px; } h3 { font-size: 18px; margin-top: 24px; }',
    '  a { color: var(--accent); word-break: break-word; } li { margin: 6px 0; }',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    // Każdy element w osobnym wierszu: przegląd zmian w diffie.
    ...out.join('').replace(/(<\/(?:h[1-3]|p|ul)>)/g, '$1\n').trimEnd().split('\n'),
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// module.path — katalog tego pliku (Node: „The directory name of the module”, https://nodejs.org/api/modules.html#modulepath).
const root = join(module.path, '../..');
const SOURCE = join(root, 'docs/privacy-policy.md');
const PAGE = join(root, 'site/privacy/index.html');
const build = () => render(readFileSync(SOURCE, 'utf8'));

module.exports = { render, build, PAGE };

if (require.main === module && process.argv.includes('--write')) {
  mkdirSync(join(root, 'site/privacy'), { recursive: true });
  writeFileSync(PAGE, build());
  console.log(`Zapisano ${PAGE}`);
}
