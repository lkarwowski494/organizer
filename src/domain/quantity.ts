/**
 * Ilość w nazwie pozycji zakupów (D77): „mleko 2”, „2 mleka”, „jabłka 1,5 kg”, „jajka x10”, „woda 6 szt.”.
 * „x” to krotność (×2). Tylko do wyświetlania — w bazie zostaje to, co wpisała osoba (bez nowej kolumny i bez ryzyka złego odczytu).
 * Liczba z przecinkiem albo kropką; jednostka z listy (src/config/quantity.pl.ts). Bez jednostki — tylko liczba
 * całkowita 1–99 (żeby „Cola 0,5” albo „mleko 3,2%” nie zostały rozpoznane jako ilość). Zakres 1–99 i krotność
 * „x” do 3 cyfr to wybory projektowe, bez źródła; jednostki mają źródło w src/config/quantity.pl.ts.
 */
import { QUANTITY_UNITS } from '../config/quantity.pl';

export type Quantity = { name: string; qty: string | null };

const unit = QUANTITY_UNITS.map((u) => u.replace('.', '\\.')).sort((a, b) => b.length - a.length).join('|');
const num = String.raw`\d+(?:[.,]\d+)?`;
const TRAILING = new RegExp(String.raw`^(.*?\S)\s+(?:(x)\s?(\d{1,3})|(${num})\s?(${unit})|([1-9]\d?))$`, 'i');
const LEADING = new RegExp(String.raw`^(?:(${num})\s?(${unit})|([1-9]\d?)\s?x?)\s+(\S.*)$`, 'i');

const show = (n: string, u: string) => `${n.replace('.', ',')} ${u.toLowerCase()}`;

export function parseQuantity(title: string): Quantity {
  const s = title.trim();
  const t = TRAILING.exec(s);
  if (t) {
    if (t[2]) return { name: t[1]!, qty: `×${t[3]}` };
    if (t[4]) return { name: t[1]!, qty: t[5]!.toLowerCase() === 'x' ? `×${t[4]}` : show(t[4], t[5]!) };
    return { name: t[1]!, qty: t[6]! };
  }
  const l = LEADING.exec(s);
  if (l) return { name: l[4]!, qty: l[1] ? (l[2]!.toLowerCase() === 'x' ? `×${l[1]}` : show(l[1], l[2]!)) : l[3]! };
  return { name: s, qty: null };
}
