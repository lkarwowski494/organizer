import * as fc from 'fast-check';

import { config } from '../../config';
import { inviteUrl, parseInviteToken } from '../invite-link';

const tok = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);

describe('link zaproszenia', () => {
  it('link i token w obie strony', () => {
    expect(inviteUrl(tok)).toBe(`${config.URL_SCHEME}://invite/${tok}`);
    expect(parseInviteToken(inviteUrl(tok))).toBe(tok);
    expect(parseInviteToken(`  ${inviteUrl(tok)}?x=1 `)).toBe(tok);
    expect(parseInviteToken(`${inviteUrl(tok)}#a`)).toBe(tok);
    expect(parseInviteToken(tok.toUpperCase())).toBe(tok);
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
