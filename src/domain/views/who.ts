/**
 * Kto (D119): osoba przypisana do zadania albo odpowiedzialna za wydarzenie, do wiersza na liście.
 * `me` — to ja (ekran pokaże „Ty”); usunięty z grupy albo nieznany identyfikator — brak osoby (D132).
 */
import type { Tables } from './model';

export type Person = { name: string; me: boolean };

export function personOf(t: Tables, userId: string, memberId: string | null): Person | null {
  const m = memberId === null ? undefined : t.group_members?.[memberId];
  // D132: usunięty z grupy — nikt konkretny.
  if (!m || m.deleted_at != null) return null;
  return { name: String(m.display_name ?? ''), me: m.user_id === userId };
}
