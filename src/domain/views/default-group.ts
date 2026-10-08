/**
 * Grupa domyślna nowego wpisu (decyzje właściciela 8.10.2026: PW-3 / audyt 2 M-24 — szybkie dodawanie w Moich sprawach;
 * PW-37 / M-118 — później także formularze wydarzenia, rutyny i listy). Ustawienie „Grupa domyślna” ma wartość
 * `LAST_USED` („Ostatnio użyta”, domyślna) albo id konkretnej grupy. Ostatnio użytą grupę zapisuje jedno miejsce:
 * `useDefaultGroup().remember` (src/app/default-group.tsx).
 */

/** Wartość ustawienia „Grupa domyślna” = „Ostatnio użyta”. Każda inna wartość to id grupy. */
export const LAST_USED = 'last';

/**
 * Grupa, od której startuje nowy wpis. `groups` — grupy, w których mogę tworzyć ten rodzaj wpisu, w kolejności ekranu
 * (osobista pierwsza). Konkretna grupa z ustawienia, dopóki jest wśród `groups`; „Ostatnio użyta” (także gdy ustawionej
 * grupy już nie ma) — ostatnio użyta, jeśli nadal jest wśród `groups`; inaczej pierwsza z nich; bez grup — `null`.
 */
export function startGroup(groups: readonly { id: string }[], setting: string | null, last: string | null): string | null {
  // `LAST_USED` nie jest id żadnej grupy (id to UUID), więc samo sprawdzenie przynależności je pomija.
  const valid = (id: string | null) => (groups.some((g) => g.id === id) ? id : null);
  return valid(setting) ?? valid(last) ?? groups[0]?.id ?? null;
}
