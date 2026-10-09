/**
 * Jednostki rozpoznawane w ilościach na liście zakupów (D77). Jednostki miar z układu SI i ich symbole
 * (BIPM, „The International System of Units”, https://www.bipm.org/en/publications/si-brochure: kg, g, l/L, ml/mL)
 * oraz skróty potoczne list zakupów (szt., op., opak., dag, x) — wybór projektowy, bez źródła normatywnego.
 * Kropka po jednostce („2 kg.”) jest dozwolona przy każdej (audyt 3, N-173).
 */
export const QUANTITY_UNITS = ['kg', 'dag', 'g', 'l', 'ml', 'szt', 'szt.', 'op', 'op.', 'opak', 'opak.', 'x'] as const;

/**
 * Opakowania jako jednostki („woda 6 butelek”, „piwo 4 puszki”, „2 kartony mleka”; audyt 3, N-173) — wybór projektowy
 * jak szt./op. Formy, które stoją po liczbie (mianownik obu liczb i dopełniacz liczby mnogiej), z Wikisłownika (szablon
 * odmiany w haśle, pobrane 9.10.2026), np. https://pl.wiktionary.org/wiki/butelka: „mianownik | butelka | butelki”,
 * „dopełniacz | butelki | butelek”.
 */
export const QUANTITY_PACKAGES = [
  'butelka', 'butelki', 'butelek', 'puszka', 'puszki', 'puszek', 'słoik', 'słoiki', 'słoików', 'karton', 'kartony', 'kartonów',
  'opakowanie', 'opakowania', 'opakowań',
] as const;

/** Słowa, po których liczba należy do nazwy, a nie jest ilością („pieluchy rozmiar 4”; audyt 3, N-173). */
export const QUANTITY_NOT_AFTER = ['rozmiar', 'rozm.', 'nr'] as const;
