/**
 * Czy sprawa dotyczy mnie — reguła „Moje sprawy” (D89; wcześniej „Dotyczy mnie”, ADR 0006, 0011), wspólna dla zadań
 * i zakupów (D73): moja osoba, albo bez osoby w mojej grupie osobistej, albo bez osoby z terminem (każdy w grupie może
 * to zrobić). Osoba usunięta z grupy albo która z niej wyszła to „nikt konkretny” (D132). Audyt 2 (M-22, R-7, P-11):
 * zakupy takiej osoby znikały wszystkim z Moich spraw i przypomnień, bo reguła zakupów tego nie uwzględniała.
 */
import type { Due } from '../deadlines';
import type { GroupItem } from './index';
import { asMember, rows, type Tables } from './model';

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

export function concernsMe(memberId: string | null, g: Pick<GroupItem, 'kind' | 'me'>, due: Due, live: ReadonlySet<string>): boolean {
  const who = livePerson(memberId, live);
  return who === g.me.member_id || (who === null && (g.kind === 'personal' || due !== null));
}
