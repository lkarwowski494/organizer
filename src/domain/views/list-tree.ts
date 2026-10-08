/**
 * Wiersze ekranu listy (audyt 2, M-82, M-83; T-7, T-8, R-15, U-61): co stoi w otwartych, a co w zamkniętych
 * (zrobione albo minione bez odhaczenia — D61; na liście zakupów „W koszyku”). Podzadania stoją pod rodzicem (D104),
 * ale otwarte podzadanie zamkniętego rodzica przechodzi do otwartych, z dopiskiem rodzica — wcześniej to samo
 * podzadanie było na liście „zrobione” z zaznaczonym polem, a w Moich sprawach zaległe. Z tego samego podziału liczy się
 * licznik listy (nagłówek listy, ekran List, grupa, „N do kupienia” w Moich sprawach), więc wszędzie jest ta sama liczba.
 */
import { config } from '../../config';
import { asTask, rows, type Tables, type Task } from './model';

type Item = { id: string; parent_id: string | null };

/** Wiersz otwartych: zadanie, rodzic (gdy przeszło spod zamkniętego rodzica) i prawdziwa głębokość w drzewie. */
export type OpenRow<X> = { x: X; parent: X | null; depth: number };
export type Split<X> = { open: OpenRow<X>[]; done: X[]; children: ReadonlyMap<string, X[]> };

export function splitList<X extends Item>(items: readonly X[], closed: (x: X) => boolean): Split<X> {
  const children = new Map<string, X[]>();
  for (const x of items) if (x.parent_id !== null) children.set(x.parent_id, [...(children.get(x.parent_id) ?? []), x]);
  const roots = items.filter((x) => x.parent_id === null);
  const open: OpenRow<X>[] = roots.filter((x) => !closed(x)).map((x) => ({ x, parent: null, depth: 0 }));
  const done = roots.filter(closed);
  // Pod zamkniętym: otwarte idą do otwartych (razem ze swoimi podzadaniami), zamknięte — szukamy dalej w głąb.
  // Głębokość jak w drzewie listy (D4), więc uszkodzone dane z cyklem też się kończą.
  const walk = (p: X, depth: number) => {
    if (depth >= config.MAX_TASK_DEPTH) return;
    for (const c of children.get(p.id) ?? []) {
      if (closed(c)) walk(c, depth + 1);
      else open.push({ x: c, parent: p, depth: depth + 1 });
    }
  };
  for (const r of done) walk(r, 0);
  return { open, done, children };
}

/**
 * Lista zakupów: pozycje nie mają własnych terminów ani ukrywania (D73 — termin mają zakupy całej listy), więc
 * otwarte = niekupione, zamknięte = w koszyku. Ta sama reguła na ekranie listy i w „N do kupienia” (shopping-trip.ts).
 */
export function shoppingSplit(t: Tables, listId: string): Split<Task> {
  const items = rows(t, 'tasks', asTask).filter((x) => x.deleted_at === null && x.list_id === listId);
  return splitList(items, (x) => x.completed_at !== null);
}
