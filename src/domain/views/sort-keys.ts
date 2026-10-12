/**
 * Kolejność zadań na liście (decyzja właściciela z 9.10.2026, audyt 3: Q37 B, N-130): domyślnie kolejność dodania,
 * a ręcznie — przesunięcie wiersza (przeciągnięcie albo „Przesuń wyżej / niżej”). Dotąd każde zadanie miało sort_key
 * „a0”, więc kolejność była alfabetyczna, a atrapa E2E nadawała „a1, a2…”, których porównanie tekstowe daje „a10” < „a2”.
 *
 * Klucz to ułamek zapisany cyframi o podstawie 62 („0–9A–Za–z”, porównanie po kodach znaków, nie localeCompare):
 * część całkowita o zmiennej długości (pierwszy znak mówi, ile cyfr ma: „a” — jedną, „b” — dwie…, „Z”, „Y”… — liczby
 * ujemne) i część ułamkowa bez zera na końcu. Między dwoma kluczami zawsze jest trzeci, a dopisywanie na koniec rośnie
 * jak licznik (a0, a1 … az, b00 …), więc tysiące zadań mieszczą się w kilku znakach (limit config.lengths.SORT_KEY).
 * Schemat „fractional indexing” jak w bibliotece rocicorp/fractional-indexing (CC0; tu napisany od nowa, bez zależności):
 * „This implementation includes variable-length integers, and the prepend/append optimization”, przykłady: bez granic
 * „a0”, potem „a1” i „a2”, „Zz” przed „a0”, „a1V” między „a1” i „a2” (https://github.com/rocicorp/fractional-indexing).
 * Pierwszy klucz „a0” to ten, który aplikacja nadawała od początku, więc stare dane są poprawne. Równe klucze (stare „a0”) rozstrzyga id — UUIDv7 rośnie z czasem
 * dodania (src/domain/ids.ts), czyli to też kolejność dodania.
 */
import { config } from '../../config';
import type { NewOp } from '../sync-engine/client';
import { asTask, rows, type Tables } from './model';

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const FIRST_KEY = 'a0';
const SMALLEST_INT = `A${'0'.repeat(26)}`;

/** Porównanie kluczy i id po kodach znaków (jak w bazie z collation „C”), niezależne od języka telefonu. */
export const compareKeys = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Kolejność rodzeństwa bez względu na termin: klucz, potem id (UUIDv7 — kolejność dodania). */
export const taskOrder = (a: { sort_key: string; id: string }, b: { sort_key: string; id: string }) => compareKeys(a.sort_key, b.sort_key) || compareKeys(a.id, b.id);

/** Długość części całkowitej według pierwszego znaku; `null` — znak spoza schematu. */
function intLength(head: string): number | null {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 95;
  if (head >= 'A' && head <= 'Z') return 92 - head.charCodeAt(0);
  return null;
}

/** Czy klucz jest w schemacie (stary zapis spoza niego, np. „a10” z atrapy E2E, dostaje nowy przy przesunięciu). */
export function validKey(k: string): boolean {
  const n = k.length ? intLength(k[0]!) : null;
  if (n === null || k.length < n || [...k].some((c) => !DIGITS.includes(c))) return false;
  return k !== SMALLEST_INT && !k.slice(n).endsWith('0');
}

/** Ułamek ściśle między `a` i `b` (cyfry po przecinku; `b === null` — jedność). Warunek: a < b, bez zer na końcu. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]!) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[da]! + midpoint(a.slice(1), null);
}

function incrementInt(x: string): string | null {
  const head = x[0]!;
  const digits = x.slice(1).split('');
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]!) + 1;
    if (d < DIGITS.length) {
      digits[i] = DIGITS[d]!;
      return head + digits.join('');
    }
    digits[i] = '0';
  }
  if (head === 'Z') return FIRST_KEY;
  if (head === 'z') return null;
  const next = String.fromCharCode(head.charCodeAt(0) + 1);
  if (next > 'a') digits.push('0');
  else digits.pop();
  return next + digits.join('');
}

function decrementInt(x: string): string {
  const head = x[0]!;
  const digits = x.slice(1).split('');
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]!) - 1;
    if (d >= 0) {
      digits[i] = DIGITS[d]!;
      return head + digits.join('');
    }
    digits[i] = 'z';
  }
  // Najmniejszej części całkowitej (SMALLEST_INT) tu nie ma — keyBetween dzieli wtedy ułamek.
  if (head === 'a') return 'Zz';
  const prev = String.fromCharCode(head.charCodeAt(0) - 1);
  if (prev < 'Z') digits.push('z');
  else digits.pop();
  return prev + digits.join('');
}

const intPart = (k: string) => k.slice(0, intLength(k[0]!)!);

/** Klucz ściśle między `a` i `b` (`null` — początek albo koniec). Warunek: oba poprawne (validKey) i a < b. */
export function keyBetween(a: string | null, b: string | null): string {
  if (a === null && b === null) return FIRST_KEY;
  if (a === null) {
    const ib = intPart(b!);
    const fb = b!.slice(ib.length);
    if (ib === SMALLEST_INT) return ib + midpoint('', fb);
    return fb !== '' ? ib : decrementInt(ib);
  }
  const ia = intPart(a);
  const fa = a.slice(ia.length);
  if (b === null) return incrementInt(ia) ?? ia + midpoint(fa, null);
  const ib = intPart(b);
  if (ia === ib) return ia + midpoint(fa, b.slice(ib.length));
  const next = incrementInt(ia)!;
  return next < b ? next : ia + midpoint(fa, null);
}

/** Klucz nowego zadania: za ostatnim rodzeństwem (ta sama lista i rodzic, także zrobione i w koszu) — kolejność dodania. */
export function appendKey(t: Tables, listId: string, parentId: string | null): string {
  const keys = rows(t, 'tasks', asTask)
    .filter((x) => x.list_id === listId && x.parent_id === parentId && validKey(x.sort_key))
    .map((x) => x.sort_key);
  const last = keys.sort(compareKeys).at(-1);
  return last === undefined ? FIRST_KEY : keyBetween(last, null);
}

/**
 * Przesunięcie: `items` w kolejności z ekranu, wiersz z miejsca `from` na miejsce `to`. Zwykle jedna zmiana — nowy klucz
 * między sąsiadami; gdy sąsiedzi mają równe albo stare klucze (sprzed tej zmiany wszystkie „a0”), albo klucz byłby za
 * długi, nowe klucze dostaje cały fragment po kolei (tylko wiersze, którym klucz się zmienia).
 */
export function moveOps(items: readonly { id: string; sort_key: string }[], from: number, to: number): NewOp[] {
  if (from === to || !items[from] || !items[to]) return [];
  const order = [...items];
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved!);
  const prev = order[to - 1]?.sort_key ?? null;
  const next = order[to + 1]?.sort_key ?? null;
  const fits = (prev === null || validKey(prev)) && (next === null || validKey(next)) && (prev === null || next === null || prev < next);
  const key = fits ? keyBetween(prev, next) : null;
  const patch = (id: string, sort_key: string): NewOp => ({ kind: 'patch', entity: 'tasks', id, set: { sort_key } });
  if (key !== null && key.length <= config.lengths.SORT_KEY) return [patch(moved!.id, key)];
  let k: string | null = null;
  return order.flatMap((x) => {
    k = keyBetween(k, null);
    return x.sort_key === k ? [] : [patch(x.id, k)];
  });
}

/** Grupa wierszy, wśród których przesunięcie coś znaczy: ten sam termin (lista stoi najpierw według terminu, D16). */
export const dueBucket = (due: { date: string; time: string | null } | null) => (due === null ? '' : `${due.date}|${due.time ?? ''}`);

/** Miejsca, na które można przesunąć wiersz `i`: ciągły fragment sąsiadów z tym samym terminem (`dueBucket`). */
export function moveRange(buckets: readonly string[], i: number): { lo: number; hi: number } {
  let lo = i;
  let hi = i;
  while (lo > 0 && buckets[lo - 1] === buckets[i]) lo--;
  while (hi < buckets.length - 1 && buckets[hi + 1] === buckets[i]) hi++;
  return { lo, hi };
}

/**
 * Przeciąganie: miejsce upuszczenia wiersza `from` przesuniętego o `dy` punktów, w granicach `lo`–`hi` (moveRange).
 * Wiersz zajmuje miejsce sąsiada, gdy minie połowę jego wysokości (`heights` — zmierzone wysokości wierszy).
 */
export function dropIndex(heights: readonly number[], from: number, dy: number, lo: number, hi: number): number {
  let to = from;
  let passed = 0;
  if (dy > 0) {
    while (to < hi && dy > passed + heights[to + 1]! / 2) passed += heights[++to]!;
  } else {
    while (to > lo && -dy > passed + heights[to - 1]! / 2) passed += heights[--to]!;
  }
  return to;
}

/**
 * Przesunięcie na ekranie listy: `items` w kolejności z ekranu (termin, potem klucz). Klucze dostaje tylko fragment
 * z tym samym terminem (moveRange) — zadania z innym terminem stoją gdzie indziej i ich kluczy nie ruszamy; miejsce spoza
 * fragmentu — nic.
 */
export function moveInList(items: readonly { id: string; sort_key: string; due: { date: string; time: string | null } | null }[], from: number, to: number): NewOp[] {
  if (!items[from]) return [];
  const { lo, hi } = moveRange(items.map((x) => dueBucket(x.due)), from);
  return to < lo || to > hi ? [] : moveOps(items.slice(lo, hi + 1), from - lo, to - lo);
}
