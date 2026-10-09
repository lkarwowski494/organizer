/**
 * Glify interfejsu (audyt 2, M-293; decyzja PWD-24 A z 8.10.2026): systemowe symbole SF Symbols dla strzałek, ✓, ✕, +
 * i ˅/˄ — jeden krój i grubość wszędzie, w jednym miejscu.
 *
 * expo-symbols (https://docs.expo.dev/versions/v57.0.0/sdk/symbols/): „On iOS and tvOS, it uses SF Symbols”; SymbolView
 * ma `size` („The size of the symbol”), `tintColor` („The tint color to apply to the symbol”), `weight` i `fallback`
 * („Fallback to render when a symbol for the given platform is not defined”). Strona nie mówi o Dynamic Type, więc
 * rozmiar skalujemy sami mnożnikiem czcionki systemu (useWindowDimensions().fontScale,
 * https://reactnative.dev/docs/usewindowdimensions), z tym samym limitem co inne elementy o stałym kształcie
 * (fontScale.FIXED_MAX, M-43).
 *
 * Zapas tekstowy (ten sam znak krojem systemowym, rośnie z Dynamic Type jak tekst) rysuje się tylko tam, gdzie nie ma
 * widoku natywnego SymbolView — w testach Jest i gdyby modułu natywnego zabrakło. SymbolView to widok, nie tekst, więc
 * glif nigdy nie stoi wewnątrz <Text> (wszystkie miejsca użycia stawiają go obok tekstu w wierszu).
 * Glif jest ozdobą: znaczenie niesie etykieta VoiceOvera elementu, w którym stoi, więc sam nie jest czytany.
 */
import { SymbolView } from 'expo-symbols';
import { Text, useWindowDimensions } from 'react-native';

import { useTheme } from './theme';

/** Rola → nazwa w SF Symbols i znak zapasowy. `more`/`less` — wiersz do rozwinięcia, zwinięty/rozwinięty (M-141). */
const GLYPHS = {
  next: { sf: 'chevron.right', text: '›' },
  prev: { sf: 'chevron.left', text: '‹' },
  check: { sf: 'checkmark', text: '✓' },
  close: { sf: 'xmark', text: '✕' },
  add: { sf: 'plus', text: '+' },
  more: { sf: 'chevron.down', text: '˅' },
  less: { sf: 'chevron.up', text: '˄' },
} as const;
export type GlyphName = keyof typeof GLYPHS;

/** `place` — rozmiar według miejsca: wiersz i pasek (row), nagłówek okresu (period), pole odhaczenia (check), obok tekstu (inline). */
export function Glyph({ name, color, place = 'row' }: { name: GlyphName; color: string; place?: 'row' | 'period' | 'check' | 'inline' }) {
  const { size, fontScale } = useTheme();
  const { fontScale: system } = useWindowDimensions();
  const pt = { row: size.GLYPH_ROW, period: size.GLYPH_PERIOD, check: size.GLYPH_CHECK, inline: size.CONTROL }[place];
  const g = GLYPHS[name];
  const fallback = (
    <Text accessible={false} importantForAccessibility="no" maxFontSizeMultiplier={fontScale.FIXED_MAX} style={{ fontSize: pt, fontWeight: '600', color }}>
      {g.text}
    </Text>
  );
  return (
    <SymbolView
      testID={`glyph-${name}`}
      name={g.sf}
      size={glyphSize(pt, system, fontScale.FIXED_MAX)}
      tintColor={color}
      weight="semibold"
      fallback={fallback}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/** Rozmiar symbolu przy danym mnożniku Dynamic Type (brak mnożnika = 1), najwyżej `max` razy rozmiar bazowy. */
export const glyphSize = (pt: number, scale: number, max: number) => Math.round(pt * Math.min(scale > 0 ? scale : 1, max));
