/**
 * Czy sprawa dotyczy mnie — reguła „Moje sprawy” (D89; wcześniej „Dotyczy mnie”, ADR 0006, 0011), wspólna dla zadań
 * i zakupów (D73): moja osoba, albo bez osoby w mojej grupie osobistej, albo bez osoby z terminem (każdy w grupie może
 * to zrobić). Osoba usunięta z grupy albo która z niej wyszła to „nikt konkretny” (D132). Audyt 2 (M-22, R-7, P-11):
 * zakupy takiej osoby znikały wszystkim z Moich spraw i przypomnień, bo reguła zakupów tego nie uwzględniała.
 * Lista „Tylko ja” działa jak grupa osobista: sprawa bez osoby trafia do moich spraw (decyzja właściciela z 8.10.2026,
 * audyt 2: PW-18 A, M-108).
 */
import type { Due } from '../deadlines';
import type { GroupItem } from './index';
import { asMember, type List, rows, type Tables } from './model';

/** Żywi członkowie (bez usuniętych) — osoba usunięta z grupy to „nikt konkretny” (D132). */
export function liveMemberIds(t: Tables): Set<string> {
  return new Set(
    rows(t, 'group_members', asMember)
      .filter((m) => m.deleted_at === null)
      .map((m) => m.member_id),
  );
}

/** Osoba sprawy według D132: usunięta z grupy albo nieznana → `null` (nikt konkretny). */
export function livePerson(memberId: string | null, live: ReadonlySet<string>): string | null {
  return memberId !== null && live.has(memberId) ? memberId : null;
}

/**
 * Moja lista „Tylko ja” (widzi ją tylko właściciel). Lista utworzona na tym telefonie przed wysłaniem nie ma jeszcze
 * właściciela (ustawia go serwer, lists_guard) — innej prywatnej listy niż własna telefon i tak nie dostaje (RLS).
 */
export function ownPrivateList(l: Pick<List, 'visibility' | 'owner_member_id'>, g: Pick<GroupItem, 'me'>): boolean {
  return l.visibility === 'private' && (l.owner_member_id === null || l.owner_member_id === g.me.member_id);
}

/** `ownPrivate` — sprawa z mojej listy „Tylko ja” (ownPrivateList). */
export function concernsMe(memberId: string | null, g: Pick<GroupItem, 'kind' | 'me'>, due: Due, live: ReadonlySet<string>, ownPrivate: boolean): boolean {
  const who = livePerson(memberId, live);
  return who === g.me.member_id || (who === null && (g.kind === 'personal' || ownPrivate || due !== null));
}
