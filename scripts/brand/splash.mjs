// Ekran startowy iOS z jednego źródła (ADR-0045): assets/brand/splash.svg (klatka 0 animacji przy starcie — plik generuje
// test src/config/__tests__/splash.contract.test.ts z funkcji introSvg w src/domain/intro.ts) → assets/splash.png
// 1024×1024 z przezroczystym tłem (tło jasne i ciemne daje wtyczka expo-splash-screen w app.json).
//
//   UPDATE_SPLASH=1 npx jest src/config/__tests__/splash.contract.test.ts   # po zmianie src/config/intro.ts albo brand-icon.ts
//   node scripts/brand/splash.mjs                                          # Playwright z Chromium (w sesji chmurowej globalnie)
//
// Ten sam test sprawdza piksele PNG (wstążki w miejscach z klatki 0, przezroczystość poza nimi).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require(execSync('npm root -g').toString().trim() + '/playwright');
}
const svg = readFileSync(new URL('../../assets/brand/splash.svg', import.meta.url), 'utf8');
const browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.screenshot({ path: new URL('../../assets/splash.png', import.meta.url).pathname, omitBackground: true });
await browser.close();
console.log('assets/splash.png OK');
