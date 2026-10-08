/**
 * „@imię” w szybkim dodawaniu (D91, ADR 0019): „basen jutro 19.00 @Ala” → zadanie w grupie, w której jest Ala,
 * z Alą jako osobą odpowiedzialną. Imię porównujemy z początkiem imienia członka grupy bez wielkości liter i polskich
 * znaków („@ala”, „@Ala”; odmiana nie jest rozpoznawana: „@Alę” nie pasuje, a „@Alą” pasuje tylko dlatego, że ą → a).
 * Pomijamy mnie samego i grupy, w których jestem dzieckiem (dziecko nie przypisuje, D34). Wiele dopasowań → telefon pyta, którą osobę i grupę wybrać.
 */
import { groupsView } from './index';
import type { Tables } from './model';

export type Mention = { start: number; end: number; name: string };
export type MentionTarget = { groupId: string; groupName: string; memberId: string; displayName: string };

const AT = /(^|\s)@([\p{L}\p{N}_-]+)/u;

export type MentionResolution =
  | { kind: 'none' }
  | { kind: 'one'; target: MentionTarget }
  | { kind: 'many'; name: string; targets: MentionTarget[] }
  | { kind: 'unknown'; name: string };

/** Pierwsze „@słowo” w tekście; `text` bez niego (pozostałe spacje złączone). */
export function extractMention(text: string): { text: string; mention: Mention | null } {
  const m = AT.exec(text);
  if (!m) return { text, mention: null };
  const start = m.index + m[1]!.length;
  const end = start + 1 + m[2]!.length;
  return { text: `${text.slice(0, start)}${text.slice(end)}`.replace(/\s+/g, ' ').trim(), mention: { start, end, name: m[2]! } };
}

const FOLD: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
const fold = (s: string) => s.toLocaleLowerCase('pl').replace(/[ąćęłńóśźż]/g, (c) => FOLD[c]!);

/** Kto pasuje do „@name”: w moich grupach (poza tymi, w których jestem dzieckiem), bez mnie, po kolejności grup. */
export function mentionTargets(t: Tables, userId: string, name: string): MentionTarget[] {
  const q = fold(name);
  if (!q) return [];
  const out: MentionTarget[] = [];
  const all = Object.values(t.group_members ?? {});
  for (const g of groupsView(t, userId)) {
    if (g.me.role === 'child') continue;
    const members = all
      .filter((m) => m.group_id === g.id && m.deleted_at == null && m.user_id !== userId)
      .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), 'pl'));
    for (const m of members) {
      if (fold(String(m.display_name ?? '')).startsWith(q)) out.push({ groupId: g.id, groupName: g.name, memberId: String(m.member_id), displayName: String(m.display_name) });
    }
  }
  return out;
}

/**
 * „@imię” w tekście: brak, jedno dopasowanie, kilka (telefon pyta, którą osobę i grupę, D91) albo żadnego — wtedy też
 * pytamy, czy dodać bez osoby, zamiast cicho zostawić „@Zosia” w nazwie w Osobistych (audyt 2, M-169).
 */
export function resolveMention(t: Tables, userId: string, text: string): MentionResolution {
  const { mention } = extractMention(text);
  if (!mention) return { kind: 'none' };
  const targets = mentionTargets(t, userId, mention.name);
  if (targets.length === 1) return { kind: 'one', target: targets[0]! };
  return targets.length ? { kind: 'many', name: mention.name, targets } : { kind: 'unknown', name: mention.name };
}

/** Tekst z „@imię” zastąpionym spacjami tej samej długości — odklikane fragmenty (ignore) zachowują pozycje. */
export function blankMention(text: string): string {
  const { mention } = extractMention(text);
  return mention ? `${text.slice(0, mention.start)}${' '.repeat(mention.end - mention.start)}${text.slice(mention.end)}` : text;
}
