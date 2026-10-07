/**
 * Link zaproszenia: io.github.lkarwowski494.organizer://invite/<token> (schemat D40 = config.URL_SCHEME).
 * Token z serwera to 64 znaki szesnastkowe (2 × UUID bez kresek, private.create_invite).
 */
import { config } from '../config';

const TOKEN = /^[0-9a-f]{64}$/;

export function inviteUrl(token: string): string {
  return `${config.URL_SCHEME}://invite/${token}`;
}

/** Token z wklejonego linku albo samego kodu; `null`, gdy nie wygląda na zaproszenie. */
export function parseInviteToken(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (TOKEN.test(s)) return s;
  const m = /^[a-z0-9.+-]+:\/\/invite\/([0-9a-f]{64})(?:[?#].*)?$/.exec(s);
  return m && s.startsWith(`${config.URL_SCHEME}://`) ? m[1]! : null;
}
