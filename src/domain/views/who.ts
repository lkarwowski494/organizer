/**
 * Kto (D119): osoba przypisana do zadania albo odpowiedzialna za wydarzenie, do wiersza na liście.
 * `me` — to ja (ekran pokaże „Ty”); usunięty członek dalej ma imię (historia), nieznany identyfikator — brak osoby.
 */
import type { Tables } from './model';

export type Person = { name: string; me: boolean };

export function personOf(t: Tables, userId: string, memberId: string | null): Person | null {
  const m = memberId === null ? undefined : t.group_members?.[memberId];
  if (!m) return null;
  return { name: String(m.display_name ?? ''), me: m.user_id === userId };
}
