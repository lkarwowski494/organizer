/**
 * Polska odmiana liczebników (D30): 1 zadanie, 2 zadania, 5 zadań, 22 zadania, 112 zadań.
 *
 * Reguła wg Unicode CLDR dla języka polskiego (kategorie one / few / many; ułamki: other):
 *   one:  n = 1
 *   few:  n % 10 ∈ 2..4 i n % 100 ∉ 12..14
 *   many: pozostałe liczby całkowite (0, 5–21, 25–31, …)
 *   other: liczby niecałkowite („1,5 zadania”)
 * Źródło: https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html
 * (sekcja „Polish”).
 */
export type PluralForms = {
  one: string;
  few: string;
  many: string;
  /** Forma dla ułamków; gdy brak, używana jest forma `few` (np. „1,5 zadania”). */
  other?: string;
};

export type PluralCategory = 'one' | 'few' | 'many' | 'other';

export function pluralCategory(n: number): PluralCategory {
  if (!Number.isFinite(n)) throw new RangeError(`plural: nieprawidłowa liczba ${n}`);
  if (!Number.isInteger(n)) return 'other';
  const abs = Math.abs(n);
  if (abs === 1) return 'one';
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'few';
  return 'many';
}

export function plural(n: number, forms: PluralForms): string {
  const category = pluralCategory(n);
  if (category === 'other') return forms.other ?? forms.few;
  return forms[category];
}
