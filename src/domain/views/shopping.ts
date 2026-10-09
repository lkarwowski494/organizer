/**
 * Lista zakupów (D85, D86; ADR 0018): działy z nagłówkami, pamięć działu w grupie, podpowiedzi z wcześniejszych
 * zakupów i stałe zakupy listy.
 *  - Dział pozycji: wybrany ręcznie (tasks.category) → zapamiętany w grupie (najnowszy ręczny wybór dla tej samej
 *    nazwy na którejkolwiek liście zakupów grupy) → zgadnięty ze słownika (src/config/shopping.pl.ts) → „Inne”.
 *  - Podpowiedzi: nazwy z list zakupów grupy (także odhaczone), najczęstsze, zaczynające się od wpisanego tekstu,
 *    bez tych, które już czekają na liście.
 *  - Pamięć i podpowiedzi biorą też pozycje usunięte (audyt 2, M-110, R-9): „Zakupy zrobione” wysyła kupione do kosza,
 *    a pamięć grupy ma zostać. Ograniczenie: telefon trzyma usunięte pozycje do wyczyszczenia kosza
 *    (config.sync.TOMBSTONE_DAYS, 30 dni) — starsze wybory i podpowiedzi znikają.
 *  - Stałe zakupy: lists.staples (nazwy bez ilości). „Dodaj stałe” tworzy pozycje dla tych, których na liście nie ma —
 *    także w koszyku (decyzja właściciela z 8.10.2026, audyt 2: PWD-19 A, M-288: kupione w tych zakupach się nie dubluje).
 *    Dodanie
 *    i usunięcie to polecenia serwera staple_add / staple_remove (audyt 2, M-111) — zmieniają jedną nazwę, nie całą
 *    tablicę, więc zmiany z dwóch telefonów (jeden bez sieci) się nie nadpisują.
 */
import { config } from '../../config';
import { SHOPPING_CATEGORIES, SHOPPING_KEYWORDS, type ShoppingCategory } from '../../config/shopping.pl';
import type { NewOp, Row } from '../sync-engine/client';
import { parseQuantity } from '../quantity';

type Tables = { readonly [e: string]: { readonly [id: string]: Row } };

const titleOf = (x: Row) => String(x.title ?? '');
const versionOf = (x: Row) => Number(x.version ?? 0);

const KEYS = new Set<string>(SHOPPING_CATEGORIES.map((c) => c.key));
const isCategory = (v: unknown): v is ShoppingCategory => typeof v === 'string' && KEYS.has(v);

/** Nazwa do porównań: bez ilości, małymi literami, pojedyncze spacje. */
export function itemKey(title: string): string {
  return parseQuantity(title).name.toLocaleLowerCase('pl').replace(/\s+/g, ' ').trim();
}

type Word = { text: string; prefix: boolean };
type Entry = Word & { cat: ShoppingCategory; parts: Word[] };
const wordOf = (w: string): Word => ({ text: w.replace(/\*$/, ''), prefix: w.endsWith('*') });
const fits = (token: string, w: Word) => (w.prefix ? token.startsWith(w.text) : token === w.text);
const ENTRIES: Entry[] = Object.entries(SHOPPING_KEYWORDS).flatMap(([cat, words]) =>
  words.map((w) => ({ cat: cat as ShoppingCategory, ...wordOf(w), parts: w.split(' ').map(wordOf) })),
);
const PHRASES = ENTRIES.filter((e) => e.parts.length > 1).sort((a, b) => b.text.length - a.text.length);
const WORDS = ENTRIES.filter((e) => e.parts.length === 1);

/** Czy fraza (słowo po słowie, „*” na końcu słowa = jego początek) stoi gdzieś w nazwie. */
const phraseIn = (tokens: string[], p: Entry) => tokens.some((_, i) => p.parts.every((w, j) => tokens[i + j] !== undefined && fits(tokens[i + j]!, w)));

/** Dział ze słownika (heurystyka); nierozpoznane → „other”. */
export function guessCategory(title: string): ShoppingCategory {
  const tokens = itemKey(title).split(' ');
  // Audyt 2 (P17): „*” działa w każdym słowie frazy — dotąd „przysmak* dla” szukało dosłownej gwiazdki i nie pasowało nigdy.
  const phrase = PHRASES.find((p) => phraseIn(tokens, p));
  if (phrase) return phrase.cat;
  for (const word of tokens) {
    let best: Entry | undefined;
    for (const e of WORDS) {
      if (fits(word, e) && (!best || e.text.length > best.text.length)) best = e;
    }
    if (best) return best.cat;
  }
  return 'other';
}

const shoppingListIds = (t: Tables, groupId: string) =>
  new Set(Object.values(t.lists ?? {}).filter((l) => l.group_id === groupId && l.kind === 'shopping' && l.deleted_at == null).map((l) => String(l.id)));

/** Pozycje list zakupów grupy, także usunięte (pamięć i podpowiedzi — opis wyżej). */
const itemsOf = (t: Tables, groupId: string) => {
  const lists = shoppingListIds(t, groupId);
  return Object.values(t.tasks ?? {}).filter((x) => lists.has(String(x.list_id)));
};

/**
 * Kiedy wybrano dział pozycji: wersja ostatniego wpisu historii (activity, private.log_activity: {kolumna: [stara,
 * nowa]}), który zmienił dział (audyt 2, M-110, R-10 — wersja wiersza rośnie też przy odhaczeniu, więc odhaczenie
 * starszej pozycji przywracało dawny wybór). Pozycja → { wersja, ustawiony dział }.
 */
function categoryChanges(t: Tables, groupId: string): { changes: Map<string, { v: number; cat: unknown }>; oldest: number } {
  const out = new Map<string, { v: number; cat: unknown }>();
  // Najstarsza wersja historii grupy: starsze wpisy usunęła retencja (config.retention.ACTIVITY_DAYS, audyt 2, M-62).
  let oldest = Infinity;
  for (const a of Object.values(t.activity ?? {})) {
    if (a.group_id !== groupId) continue;
    const v = versionOf(a);
    oldest = Math.min(oldest, v);
    const change = (a.changes as Record<string, unknown> | null | undefined)?.category;
    if (a.entity !== 'tasks' || !Array.isArray(change)) continue;
    const id = String(a.entity_id);
    if ((out.get(id)?.v ?? -1) < v) out.set(id, { v, cat: change[1] });
  }
  return { changes: out, oldest };
}

/**
 * Ręczne wybory działu w grupie: nazwa → dział. Najnowszy wybór wygrywa: chwila zmiany działu z historii; dział, którego
 * historia jeszcze nie zna (zmiana z tego telefonu przed wysłaniem), jest najnowszy. Remis — wyższa wersja wiersza.
 * Pozycja starsza niż cała zachowana historia (wpis wyboru usunęła retencja) ma wybór najpóźniej w swojej wersji wiersza.
 */
export function categoryMemory(t: Tables, groupId: string): Map<string, ShoppingCategory> {
  const { changes, oldest } = categoryChanges(t, groupId);
  const best = new Map<string, { cat: ShoppingCategory; at: number; v: number }>();
  for (const x of itemsOf(t, groupId)) {
    if (!isCategory(x.category)) continue;
    const k = itemKey(titleOf(x));
    const c = changes.get(String(x.id));
    const v = versionOf(x);
    const at = c ? (c.cat === x.category ? c.v : Infinity) : v < oldest ? v : Infinity;
    const cur = best.get(k);
    if (!cur || at > cur.at || (at === cur.at && v >= cur.v)) best.set(k, { cat: x.category, at, v });
  }
  return new Map([...best].map(([k, { cat }]) => [k, cat]));
}

export function categoryOf(row: Row, memory: ReadonlyMap<string, ShoppingCategory>): ShoppingCategory {
  if (isCategory(row.category)) return row.category;
  return memory.get(itemKey(titleOf(row))) ?? guessCategory(titleOf(row));
}

export type Section<T> = { key: ShoppingCategory; name: string; items: T[] };

/** Pozycje w działach, w kolejności działów z konfiguracji; puste działy pominięte, kolejność w dziale zachowana. */
export function sections<T extends { id: string }>(items: readonly T[], t: Tables, groupId: string): Section<T>[] {
  const memory = categoryMemory(t, groupId);
  const by = new Map<ShoppingCategory, T[]>();
  for (const it of items) {
    const cat = categoryOf(t.tasks?.[it.id] ?? {}, memory);
    by.set(cat, [...(by.get(cat) ?? []), it]);
  }
  return SHOPPING_CATEGORIES.filter((c) => by.has(c.key)).map((c) => ({ key: c.key, name: c.name, items: by.get(c.key)! }));
}

export const categoryName = (key: ShoppingCategory) => SHOPPING_CATEGORIES.find((c) => c.key === key)!.name;

export function setCategory(taskId: string, category: ShoppingCategory): NewOp {
  return { kind: 'patch', entity: 'tasks', id: taskId, set: { category } };
}

/** Nazwy pozycji na liście: czekających (`withCart` — także tych w koszyku). */
const listKeys = (t: Tables, listId: string, withCart: boolean) =>
  new Set(Object.values(t.tasks ?? {}).filter((x) => x.list_id === listId && x.deleted_at == null && (withCart || x.completed_at == null)).map((x) => itemKey(titleOf(x))));

/** Podpowiedzi przy wpisywaniu: najczęściej kupowane w grupie, zaczynające się od tekstu (min. 2 znaki). */
export function suggestions(t: Tables, groupId: string, listId: string, text: string): string[] {
  const q = text.toLocaleLowerCase('pl').replace(/\s+/g, ' ').trim();
  if (q.length < 2) return [];
  const waiting = listKeys(t, listId, false);
  const counts = new Map<string, { n: number; name: string; v: number }>();
  for (const x of itemsOf(t, groupId)) {
    const name = parseQuantity(titleOf(x)).name.trim();
    const k = itemKey(name);
    if (!k.startsWith(q) || k === q || waiting.has(k)) continue;
    const v = versionOf(x);
    const cur = counts.get(k) ?? { n: 0, name, v: -1 };
    counts.set(k, { n: cur.n + 1, name: v >= cur.v ? name : cur.name, v: Math.max(cur.v, v) });
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'pl'))
    .slice(0, config.shopping.SUGGESTIONS)
    .map((x) => x.name);
}

/** Stałe zakupy listy (D86). */
export function staplesOf(list: Row | undefined): string[] {
  return Array.isArray(list?.staples) ? list.staples.filter((s): s is string => typeof s === 'string') : [];
}

/** Stałe, których nie ma na liście — ani wśród czekających, ani w koszyku (PWD-19 A). */
export function missingStaples(t: Tables, listId: string): string[] {
  const onList = listKeys(t, listId, true);
  return staplesOf(t.lists?.[listId]).filter((s) => !onList.has(itemKey(s)));
}

export function addStaplesOps(t: Tables, listId: string, newId: () => string): NewOp[] {
  const list = t.lists?.[listId];
  if (!list) return [];
  return missingStaples(t, listId).map((title) => ({
    kind: 'create',
    entity: 'tasks',
    id: newId(),
    group_id: String(list.group_id),
    set: { list_id: listId, parent_id: null, title, sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null },
  }));
}

export type StaplesEdit = { ok: true; op: NewOp } | { ok: false; error: 'empty' | 'duplicate' | 'full' | 'tooLong' };

/** Usunięcie stałej pozycji (po nazwie bez ilości): wszystkie stałe o tej nazwie. */
export function removeStaple(list: Row, name: string): NewOp {
  const k = itemKey(name);
  return { kind: 'cmd', cmd: 'staple_remove', args: { list_id: String(list.id), names: staplesOf(list).filter((s) => itemKey(s) === k) } };
}

/**
 * Dodanie stałej pozycji: zapisuje się sama nazwa, bez ilości (PWD-19 A — „Mleko 2” → „Mleko”; ilość dopisuje się przy
 * zakupach); bez duplikatów, limity z konfiguracji.
 */
export function addStaple(list: Row, added: string): StaplesEdit {
  const cur = staplesOf(list);
  const name = parseQuantity(added.replace(/\s+/g, ' ').trim()).name;
  if (!name) return { ok: false, error: 'empty' };
  if (name.length > config.shopping.STAPLE_MAX_LENGTH) return { ok: false, error: 'tooLong' };
  if (cur.some((s) => itemKey(s) === itemKey(name))) return { ok: false, error: 'duplicate' };
  if (cur.length >= config.shopping.STAPLES_MAX) return { ok: false, error: 'full' };
  return { ok: true, op: { kind: 'cmd', cmd: 'staple_add', args: { list_id: String(list.id), name } } };
}
