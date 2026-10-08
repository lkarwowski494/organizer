/**
 * „Co nowego” po aktualizacji (D84): krótka karta raz po instalacji nowszego buildu. Nowa osoba (wprowadzenie jeszcze
 * nieobejrzane) nie dostaje karty — wszystko jest dla niej nowe; zapamiętujemy tylko bieżący build.
 */
export type WhatsNewEntry = { readonly fromBuild: number; readonly items: readonly string[] };

export type WhatsNewDecision = { show: readonly string[] | null; remember: number | null };

/**
 * `entries` od najnowszego. `seen` = ostatni build, dla którego karta była zamknięta (albo pominięta).
 * Wynik: co pokazać i co zapamiętać od razu. Pokazujemy punkty wszystkich wpisów nowszych niż `seen` i nie nowszych niż
 * bieżący build, od najnowszego — kto pominął kilka buildów (albo Apple odrzucił build, D123), widzi wszystko, co ominął.
 * Bez `seen` (pierwsza karta po wprowadzeniu karty) — tylko najnowszy wpis.
 */
export function whatsNew(entries: readonly WhatsNewEntry[], build: number, seen: number | null, welcomeSeen: boolean): WhatsNewDecision {
  if (!Number.isFinite(build)) return { show: null, remember: null };
  if (!welcomeSeen) return { show: null, remember: seen === build ? null : build };
  const fresh = entries.filter((e) => e.fromBuild <= build && (seen === null || e.fromBuild > seen));
  const show = seen === null ? fresh.slice(0, 1) : fresh;
  return show.length ? { show: show.flatMap((e) => e.items), remember: null } : { show: null, remember: seen === build ? null : build };
}
