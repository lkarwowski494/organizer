import * as fc from 'fast-check';

import { config } from '../../config';
import { groupDigits, inviteUrl, joinUrl, parseInviteToken, parseJoin } from '../invite-link';

const tok = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);

describe('link zaproszenia', () => {
  it('link i token w obie strony', () => {
    expect(inviteUrl(tok)).toBe(`${config.URL_SCHEME}://invite/${tok}`);
    expect(parseInviteToken(inviteUrl(tok))).toBe(tok);
    expect(parseInviteToken(`  ${inviteUrl(tok)}?x=1 `)).toBe(tok);
    expect(parseInviteToken(`${inviteUrl(tok)}#a`)).toBe(tok);
    expect(parseInviteToken(tok.toUpperCase())).toBe(tok);
    // Cała wiadomość z zaproszenia (kod w osobnym wierszu); dwa kody naraz — nie zgadujemy.
    expect(parseInviteToken(`Zapraszam Cię do grupy „Rodzina”.\n\n3. Wklej ten kod:\n\n${tok}\r\n`)).toBe(tok);
    expect(parseInviteToken(`${tok}\n${'b'.repeat(64)}`)).toBeNull();
    expect(parseInviteToken(`kod: ${tok}`)).toBeNull();
  });

  it('odrzuca obce schematy, ścieżki i złe tokeny', () => {
    expect(parseInviteToken(`https://invite/${tok}`)).toBeNull();
    expect(parseInviteToken(`evil.app://invite/${tok}`)).toBeNull();
    expect(parseInviteToken(`${config.URL_SCHEME}://join/${tok}`)).toBeNull();
    expect(parseInviteToken(`${config.URL_SCHEME}://invite/${tok}0`)).toBeNull();
    expect(parseInviteToken(tok.slice(1))).toBeNull();
    expect(parseInviteToken('')).toBeNull();
  });

  it('własność: każdy 64-znakowy token przechodzi przez link bez zmian', () => {
    fc.assert(fc.property(fc.stringMatching(/^[0-9a-f]{64}$/), (t) => parseInviteToken(inviteUrl(t)) === t));
  });
});

describe('ID grupy + kod (D92–D94)', () => {
  const j = { joinId: '482913507', code: '731064' };
  const msg = `Zapraszam Cię do grupy „Rodzina”.\n\nDotknij linku: ${joinUrl(j)}\n\nAlbo w aplikacji wpisz:\nID grupy: 482 913 507\nKod: 731 064 (ważny do 9.10, 18:40)`;

  it('link https i schemat aplikacji w obie strony; cyfry w trójkach', () => {
    expect(joinUrl(j)).toBe(`${config.invites.JOIN_LINK}?g=482913507&c=731064`);
    expect(parseJoin(joinUrl(j))).toEqual(j);
    expect(parseJoin(`${config.URL_SCHEME}://join?g=482913507&c=731064`)).toEqual(j);
    expect(parseJoin(`${config.invites.JOIN_LINK}?g=482%20913%20507&c=731-064`)).toEqual(j);
    expect(groupDigits('482913507')).toBe('482 913 507');
    expect(groupDigits('731064')).toBe('731 064');
  });

  it('cała wiadomość: z linku albo z wierszy „ID grupy” i „Kod”', () => {
    expect(parseJoin(msg)).toEqual(j);
    expect(parseJoin('ID grupy: 482-913-507\nKod: 731064')).toEqual(j);
    expect(parseJoin('id grupy: 482 913 507\nkod: 731 064')).toEqual(j);
  });

  it('odrzuca obce strony, złe długości, zero na początku i niepełne dane', () => {
    expect(parseJoin('https://evil.example/j/?g=482913507&c=731064')).toBeNull();
    expect(parseJoin(`${config.invites.JOIN_LINK}?g=48291350&c=731064`)).toBeNull();
    expect(parseJoin(`${config.invites.JOIN_LINK}?g=082913507&c=731064`)).toBeNull();
    expect(parseJoin(`${config.invites.JOIN_LINK}?g=482913507&c=73106`)).toBeNull();
    expect(parseJoin(`${config.invites.JOIN_LINK}?c=731064`)).toBeNull();
    expect(parseJoin('ID grupy: 482 913 507')).toBeNull();
    expect(parseJoin('482913507 731064')).toBeNull();
    expect(parseJoin('')).toBeNull();
  });

  it('własność: każde poprawne ID i kod przechodzą przez link i wiadomość bez zmian', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100_000_000, max: 999_999_999 }), fc.integer({ min: 0, max: 999_999 }), (g, c) => {
        const x = { joinId: String(g), code: String(c).padStart(6, '0') };
        expect(parseJoin(joinUrl(x))).toEqual(x);
        expect(parseJoin(`ID grupy: ${groupDigits(x.joinId)}\nKod: ${groupDigits(x.code)}`)).toEqual(x);
      }),
    );
  });
});
