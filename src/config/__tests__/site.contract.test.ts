/**
 * Strona zaproszeń (site/, GitHub Pages, D94) musi zgadzać się z aplikacją: identyfikator aplikacji w pliku
 * apple-app-site-association = zespół Apple (fastlane) + bundle (app.json), ścieżka = config.invites.JOIN_LINK,
 * a strona sprawdza te same długości ID i kodu co config.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { config } from '../index';

const root = join(__dirname, '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('strona zaproszeń zgodna z aplikacją', () => {
  it('apple-app-site-association: appID i ścieżka /j/', () => {
    const aasa = JSON.parse(read('site/.well-known/apple-app-site-association'));
    const team = /team_id\("([A-Z0-9]+)"\)/.exec(read('fastlane/Appfile'))![1];
    const bundle = JSON.parse(read('app.json')).expo.ios.bundleIdentifier;
    expect(aasa.applinks.details).toHaveLength(1);
    expect(aasa.applinks.details[0].appIDs).toEqual([`${team}.${bundle}`]);
    const path = new URL(config.invites.JOIN_LINK).pathname;
    expect(aasa.applinks.details[0].components.map((c: { '/': string }) => c['/'])).toEqual([`${path}*`]);
    expect(path).toBe('/j/');
  });

  it('strona /j/: te same długości ID i kodu, przycisk w schemacie aplikacji', () => {
    const html = read('site/j/index.html');
    expect(html).toContain(`/^[1-9]\\d{${config.invites.JOIN_ID_DIGITS - 1}}$/`);
    expect(html).toContain(`/^\\d{${config.invites.CODE_DIGITS}}$/`);
    expect(html).toContain(`'${config.URL_SCHEME}://join?g=' + g + '&c=' + c`);
    // Bez zewnętrznych skryptów i bez wstawiania HTML z adresu.
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toContain('innerHTML');
  });
});
