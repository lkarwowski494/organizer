/**
 * Link zaproszenia: io.github.lkarwowski494.organizer://invite/<token> (schemat D40 = config.URL_SCHEME).
 * Token z serwera to 64 znaki szesnastkowe (2 × UUID bez kresek, private.create_invite).
 */
import { config } from '../config';

const TOKEN = /^[0-9a-f]{64}$/;

export function inviteUrl(token: string): string {
  return `${config.URL_SCHEME}://invite/${token}`;
}

/** Token z wklejonego linku, samego kodu albo całej wiadomości z kodem; `null`, gdy nie wygląda na zaproszenie. */
export function parseInviteToken(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (TOKEN.test(s)) return s;
  const m = /^[a-z0-9.+-]+:\/\/invite\/([0-9a-f]{64})(?:[?#].*)?$/.exec(s);
  if (m) return s.startsWith(`${config.URL_SCHEME}://`) ? m[1]! : null;
  // Wklejona cała wiadomość z zaproszenia (D67): kod stoi w osobnym wierszu.
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter((l) => TOKEN.test(l));
  return lines.length === 1 ? lines[0]! : null;
}

/** Zaproszenie ID grupy + kod (D92–D94). */
export type JoinCode = { joinId: string; code: string };

const digits = (s: string) => s.replace(/[\s-]/g, '');
const ID_RE = new RegExp(`^\\d{${config.invites.JOIN_ID_DIGITS}}$`);
const CODE_RE = new RegExp(`^\\d{${config.invites.CODE_DIGITS}}$`);
const valid = (joinId: string, code: string): JoinCode | null => (ID_RE.test(joinId) && !joinId.startsWith('0') && CODE_RE.test(code) ? { joinId, code } : null);

/** „482 913 507” / „731 064” — grupy po trzy cyfry, łatwiej dyktować. */
export const groupDigits = (s: string) => s.replace(/(\d{3})(?=\d)/g, '$1 ');

/** Link https (strona i Universal Links) z ID i kodem. */
export function joinUrl(j: JoinCode): string {
  return `${config.invites.JOIN_LINK}?g=${j.joinId}&c=${j.code}`;
}

/**
 * ID i kod z: linku https (tylko nasza strona), linku w schemacie aplikacji (…://join?g=…&c=…), wiadomości
 * z wierszami „ID grupy: …” i „Kod: …” albo z samego linku w wiadomości. `null`, gdy nic pewnego.
 */
export function parseJoin(input: string): JoinCode | null {
  const s = input.trim();
  const link = /(https:\/\/[^\s]+|[a-z0-9.+-]+:\/\/join[^\s]*)/i.exec(s)?.[1];
  if (link) {
    const ours = link.startsWith(config.invites.JOIN_LINK) || link.toLowerCase().startsWith(`${config.URL_SCHEME}://join`);
    const q = /[?&]g=([\d\s%-]+)&c=([\d\s%-]+)/.exec(link);
    if (ours && q) return valid(digits(decodeURIComponent(q[1]!)), digits(decodeURIComponent(q[2]!)));
  }
  const id = /ID grupy:\s*([\d\s-]+?)\s*$/im.exec(s)?.[1];
  const code = /Kod:\s*([\d\s-]+?)\s*(?:\(|$)/im.exec(s)?.[1];
  return id && code ? valid(digits(id), digits(code)) : null;
}
