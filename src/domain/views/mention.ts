/**
 * „@imię” w szybkim dodawaniu (D91, ADR 0019): „basen jutro 19.00 @Ala” → zadanie w grupie, w której jest Ala,
 * z Alą jako osobą odpowiedzialną. Imię porównujemy z początkiem imienia członka grupy bez wielkości liter i polskich
 * znaków („@ala”, „@Ala”; odmiana nie jest rozpoznawana: „@Alę” nie pasuje, a „@Alą” pasuje tylko dlatego, że ą → a).
 * Pomijamy mnie samego i grupy, w których jestem dzieckiem (dziecko nie przypisuje, D34). Wiele dopasowań → telefon pyta, którą osobę i grupę wybrać.
 * Siebie oznacza się „@ja”, a grupę „#nazwa” — rozstrzyga to razem z grupą chipa quick-target.ts (audyt 2, M-24).
 */
import { groupsView } from './index';
import type { Tables } from './model';

export type Mention = { start: number; end: number; name: string };
export type MentionTarget = { groupId: string; groupName: string; memberId: string; displayName: string };

const AT = /(^|\s)@([\p{L}\p{N}_-]+)/u;

/** Pierwsze „@słowo” w tekście; `text` bez niego (pozostałe spacje złączone). */
export function extractMention(text: string): { text: string; mention: Mention | null } {
  const m = AT.exec(text);
  if (!m) return { text, mention: null };
  const start = m.index + m[1]!.length;
  const end = start + 1 + m[2]!.length;
  return { text: `${text.slice(0, start)}${text.slice(end)}`.replace(/\s+/g, ' ').trim(), mention: { start, end, name: m[2]! } };
}

const FOLD: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
/** Imię albo nazwa do porównania: bez wielkości liter i polskich znaków. */
export const foldName = (s: string) => s.toLocaleLowerCase('pl').replace(/[ąćęłńóśźż]/g, (c) => FOLD[c]!);

/** Kto pasuje do „@name”: w moich grupach (poza tymi, w których jestem dzieckiem), bez mnie, po kolejności grup. */
export function mentionTargets(t: Tables, userId: string, name: string): MentionTarget[] {
  const q = foldName(name);
  if (!q) return [];
  const out: MentionTarget[] = [];
  const all = Object.values(t.group_members ?? {});
  for (const g of groupsView(t, userId)) {
    if (g.me.role === 'child') continue;
    const members = all
      .filter((m) => m.group_id === g.id && m.deleted_at == null && m.user_id !== userId)
      .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), 'pl'));
    for (const m of members) {
      if (foldName(String(m.display_name ?? '')).startsWith(q)) out.push({ groupId: g.id, groupName: g.name, memberId: String(m.member_id), displayName: String(m.display_name) });
    }
  }
  return out;
}
