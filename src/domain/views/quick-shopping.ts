/**
 * Podpowiedź „Na listę zakupów” przy polu w Moich sprawach (PW-3 wariant D, decyzja z 8.10.2026 z upoważnienia
 * właściciela; audyt 2 M-24). Tylko podpowiedź — wpis zostaje zadaniem, dopóki ktoś jej nie dotknie.
 *  - Pewne dopasowanie: cały wpis (po zdjęciu rozpoznanego terminu, „#…” i „@…”) to jeden produkt ze słownika działów
 *    (src/config/shopping.pl.ts), opcjonalnie z ilością (parseQuantity, D77): „mleko”, „2 mleka”, „chleb 2 szt.”,
 *    „papier toaletowy”. Słownik ma rdzenie z „*” („karm*”, „mop*”), które pasują też do czasowników i rzeczowników
 *    odczasownikowych, więc słowa na „-ć”, „-anie”, „-enie” nie są produktem („karmić”, „mopować”, „karmienie”).
 *  - Bez podpowiedzi dla zdań („kupić mleko dla babci”, „karmić kota”), wpisów z inną liczbą („mleko 3,2%”) i dwóch
 *    słów, z których tylko jedno jest w słowniku („ser żółty” zostaje zadaniem — bezpieczniej przeoczyć produkt niż
 *    zabrać zadanie).
 *  - Lista: ta lista zakupów grupy wpisu, której ostatnio używano (najwyższa wersja listy albo jej pozycji — wersje
 *    rosną w grupie, D32; niewysłane zmiany z tego telefonu są najnowsze).
 */
import { SHOPPING_KEYWORDS } from '../../config/shopping.pl';
import { parseQuantity } from '../quantity';
import type { Row } from '../sync-engine/client';
import { listsView } from './index';
import type { Tables } from './model';

// Ta sama składnia słownika co w shopping.ts (guessCategory): „*” na końcu = początek słowa.
const ENTRIES = Object.values(SHOPPING_KEYWORDS)
  .flat()
  .map((w) => ({ text: w.endsWith('*') ? w.slice(0, -1) : w, prefix: w.endsWith('*') }));

/** Cała nazwa to wpis słownika: dokładnie albo (wpis z „*”) jego początek z końcówką bez spacji („mąk*” → „mąka”). */
const matches = (e: (typeof ENTRIES)[number], name: string) => (e.prefix ? name.startsWith(e.text) && !name.slice(e.text.length).includes(' ') : name === e.text);

/**
 * Bezokolicznik i rzeczownik odczasownikowy („karmić”, „mopowanie”, „karmienie”) — nie produkt, choć pasuje do rdzenia.
 * Bezokolicznik kończy się na -ć (-ać, -ić, -yć, -eć, -ść, -źć; rzadziej -c: „rzec”) — Zasady pisowni PWN [54]:
 * „Na -ić, -yć kończą się formy bezokolicznika…”, https://sjp.pwn.pl/zasady/54-zakonczenia-form-bezokolicznika;629367.html;
 * rzeczowniki odczasownikowe: „Formy na -anie, -enie zachowują ściślejszy związek z czasownikiem” (prof. M. Bańko,
 * https://sjp.pwn.pl/poradnia/haslo/gerundium-czy-rzeczownik-odczasownikowy;13636.html). Bezokoliczników na -c w słowniku
 * produktów nie ma, więc ich nie sprawdzamy.
 */
const VERBAL_ENDINGS = ['ć', 'anie', 'enie'];

/** Tytuł pozycji zakupów, gdy cały wpis to jeden znany produkt (z ilością albo bez); inaczej `null`. */
export function shoppingItem(text: string): string | null {
  const title = text.replace(/\s+/g, ' ').trim();
  const name = parseQuantity(title).name.toLocaleLowerCase('pl');
  // Inna liczba niż ilość („mleko 3,2%”, „7up”) — nie wiemy, co to jest.
  if (/\d/.test(name) || VERBAL_ENDINGS.some((s) => name.endsWith(s))) return null;
  return ENTRIES.some((e) => matches(e, name)) ? title : null;
}

const version = (row: Row) => (row.version == null ? Infinity : Number(row.version));

/** Lista zakupów grupy, której ostatnio używano (widoczna dla mnie); przy remisie — pierwsza w kolejności list. */
export function recentShoppingList(t: Tables, userId: string, groupId: string): { id: string; name: string } | null {
  const tasks = Object.values(t.tasks ?? {});
  let best: { id: string; name: string; used: number } | null = null;
  for (const l of listsView(t, userId, groupId)) {
    if (l.kind !== 'shopping') continue;
    // Lista pochodzi z t.lists (listsView), więc wiersz jest.
    const used = Math.max(version(t.lists![l.id]!), ...tasks.filter((x) => x.list_id === l.id).map(version));
    if (!best || used > best.used) best = { id: l.id, name: l.name, used };
  }
  return best && { id: best.id, name: best.name };
}
