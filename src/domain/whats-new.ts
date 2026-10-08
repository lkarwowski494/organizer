/**
 * „Co nowego” po aktualizacji (D84): krótka karta raz po instalacji nowszego buildu. Nowa osoba (wprowadzenie jeszcze
 * nieobejrzane) nie dostaje karty — wszystko jest dla niej nowe; zapamiętujemy tylko bieżący build.
 */
export type WhatsNewEntry = { readonly fromBuild: number; readonly items: readonly string[] };

export type WhatsNewDecision = { show: readonly string[] | null; remember: number | null };

/**
 * `entries` od najnowszego. `seen` = ostatni build, dla którego karta była zamknięta (albo pominięta).
 * Wynik: co pokazać (punkty najnowszego wpisu nowszego niż `seen`, nie nowszego niż bieżący build) i co zapamiętać od razu.
 */
export function whatsNew(entries: readonly WhatsNewEntry[], build: number, seen: number | null, welcomeSeen: boolean): WhatsNewDecision {
  if (!Number.isFinite(build)) return { show: null, remember: null };
  if (!welcomeSeen) return { show: null, remember: seen === build ? null : build };
  const entry = entries.find((e) => e.fromBuild <= build && (seen === null || e.fromBuild > seen));
  return entry ? { show: entry.items, remember: null } : { show: null, remember: seen === build ? null : build };
}
