/**
 * Szkic formularza z „Zapisz” na telefonie (decyzja właściciela 8.10.2026, D179 / PW-20 wariant B; audyt 2, M-123):
 * wyjście gestem albo „Wróć” zostawia wpisane dane, a ponowne otwarcie tego samego formularza je przywraca.
 *  - Szkic to tylko pola, które zmieniłem (względem wartości z chwili otwarcia) — przy formularzu zmiany istniejącej rzeczy
 *    nakłada się je na jej obecne dane, więc pola zmienione w tym czasie gdzie indziej, których nie ruszałem, zostają.
 *    Pole, które zmieniłem i ja, i ktoś inny: wygrywa mój szkic (to ja je wpisałem; widzę je przed „Zapisz”).
 *  - Szkic starszy niż config.forms.DRAFT_MAX_DAYS dni przepada (wybór projektowy: tydzień przerwy to raczej porzucony
 *    zamiar niż wpis do dokończenia).
 * Zapis: JSON { at: ms, changes } w lokalnej bazie telefonu (klucz app/form-draft.ts). Zły albo obcy zapis = brak szkicu.
 */
import { config } from '../config';

/**
 * `stamp` — znacznik danych, na których szkic powstał (audyt 3, N-31: plan lekcji z chwili otwarcia); formularz
 * porównuje go z obecnymi danymi przy przywróceniu i przy zapisie.
 */
export type Draft<F> = { at: number; changes: Partial<F>; stamp?: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Pola `current` różne od `initial`. */
export function changedFields<F extends Record<string, unknown>>(initial: F, current: F): Partial<F> {
  const out: Partial<F> = {};
  for (const k of Object.keys(current) as (keyof F)[]) if (!same(initial[k], current[k])) out[k] = current[k];
  return out;
}

/** Zapis szkicu; bez zmian — null (szkic znika). */
export function encodeDraft<F>(changes: Partial<F>, nowMs: number, stamp?: string): string | null {
  return Object.keys(changes).length ? JSON.stringify({ at: nowMs, changes, ...(stamp === undefined ? {} : { stamp }) }) : null;
}

/** Odczyt: tylko znane pola (`fields`), nie starszy niż limit; inaczej null. */
export function decodeDraft<F>(raw: string | null, fields: readonly (keyof F & string)[], nowMs: number): Draft<F> | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const { at, changes, stamp } = v as { at?: unknown; changes?: unknown; stamp?: unknown };
  if (typeof at !== 'number' || nowMs - at > config.forms.DRAFT_MAX_DAYS * 86_400_000 || typeof changes !== 'object' || changes === null) return null;
  const known = Object.fromEntries(Object.entries(changes).filter(([k]) => (fields as readonly string[]).includes(k))) as Partial<F>;
  if (!Object.keys(known).length) return null;
  return typeof stamp === 'string' ? { at, changes: known, stamp } : { at, changes: known };
}
