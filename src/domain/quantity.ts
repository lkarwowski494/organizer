/**
 * Ilość w nazwie pozycji zakupów (D77): „mleko 2”, „2 mleka”, „jabłka 1,5 kg”, „jajka x10”, „woda 6 szt.”.
 * „x” to krotność (×2), z przodu albo z tyłu; „piwo 6 x 0,5 l” — sześć opakowań po 0,5 l. Opakowania („6 butelek”)
 * i słowa blokujące liczbę („rozmiar 4”) — src/config/quantity.pl.ts. Tylko do wyświetlania — w bazie zostaje to, co wpisała osoba (bez nowej kolumny i bez ryzyka złego odczytu).
 * Liczba z przecinkiem albo kropką; jednostka z listy (src/config/quantity.pl.ts). Bez jednostki — tylko liczba
 * całkowita 1–99 (żeby „Cola 0,5” albo „mleko 3,2%” nie zostały rozpoznane jako ilość). Zakres 1–99 i krotność
 * „x” do 3 cyfr to wybory projektowe, bez źródła; jednostki mają źródło w src/config/quantity.pl.ts.
 */
import { QUANTITY_NOT_AFTER, QUANTITY_PACKAGES, QUANTITY_UNITS } from '../config/quantity.pl';

export type Quantity = { name: string; qty: string | null };

const unit = [...QUANTITY_UNITS, ...QUANTITY_PACKAGES].map((u) => u.replace('.', '\\.')).sort((a, b) => b.length - a.length).join('|');
const num = String.raw`\d+(?:[.,]\d+)?`;
// Audyt 3 (N-173): kropka po każdej jednostce („2 kg.”), „6 x 0,5 l” (krotność opakowania), „x2” z przodu.
const TRAILING = new RegExp(String.raw`^(.*?\S)\s+(?:(\d{1,3})\s?x\s?(${num})\s?(${unit})\.?|(x)\s?(\d{1,3})|(${num})\s?(${unit})\.?|([1-9]\d?))$`, 'i');
const LEADING = new RegExp(String.raw`^(?:x\s?(\d{1,3})|(${num})\s?(${unit})\.?|([1-9]\d?)\s?x?)\s+(\S.*)$`, 'i');
const NOT_AFTER = new Set<string>(QUANTITY_NOT_AFTER);

const show = (n: string, u: string) => `${n.replace('.', ',')} ${u.toLowerCase()}`;
const times = (n: string, u: string) => (u.toLowerCase() === 'x' ? `×${n}` : show(n, u));

export function parseQuantity(title: string): Quantity {
  const s = title.trim();
  const t = TRAILING.exec(s);
  if (t) {
    if (t[2]) return { name: t[1]!, qty: `${t[2]} × ${show(t[3]!, t[4]!)}` };
    if (t[5]) return { name: t[1]!, qty: `×${t[6]}` };
    if (t[7]) return { name: t[1]!, qty: times(t[7], t[8]!) };
    // „pieluchy rozmiar 4” — liczba to część nazwy.
    if (!NOT_AFTER.has(t[1]!.split(' ').at(-1)!.toLocaleLowerCase('pl'))) return { name: t[1]!, qty: t[9]! };
    return { name: s, qty: null };
  }
  const l = LEADING.exec(s);
  if (l) return { name: l[5]!, qty: l[1] ? `×${l[1]}` : l[2] ? times(l[2], l[3]!) : l[4]! };
  return { name: s, qty: null };
}
