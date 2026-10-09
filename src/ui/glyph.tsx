/**
 * Glify interfejsu (audyt 2, M-293; decyzja PWD-24 A z 8.10.2026: systemowe symbole dla strzałek, ✓ i ✕, skalowane
 * z Dynamic Type). Jedno miejsce dla wszystkich glifów: dziś znak tekstowy krojem systemowym (SF Pro — ten sam krój
 * i grubość wszędzie, rośnie z Dynamic Type jak tekst), a po dodaniu pakietu expo-symbols
 * (https://docs.expo.dev/versions/v57.0.0/sdk/symbols/ — SymbolView, SF Symbols na iOS) wystarczy podmienić ten komponent.
 * Glif jest ozdobą: znaczenie niesie etykieta VoiceOvera elementu, w którym stoi, więc sam nie jest czytany.
 */
import { Text } from 'react-native';

import { useTheme } from './theme';

/** Nazwy ról z odpowiednikami w SF Symbols (do podmiany): chevron.right, chevron.left, checkmark, xmark, plus, chevron.down. */
const GLYPHS = { next: '›', prev: '‹', check: '✓', close: '✕', add: '+', more: '▾' } as const;
export type GlyphName = keyof typeof GLYPHS;

/** `place` — rozmiar według miejsca: wiersz i pasek (row), nagłówek okresu (period), pole odhaczenia (check), w tekście (inline). */
export function Glyph({ name, color, place = 'row' }: { name: GlyphName; color: string; place?: 'row' | 'period' | 'check' | 'inline' }) {
  const { size, fontScale } = useTheme();
  const fontSize = { row: size.GLYPH_ROW, period: size.GLYPH_PERIOD, check: size.GLYPH_CHECK, inline: size.CONTROL }[place];
  return (
    <Text accessible={false} importantForAccessibility="no" maxFontSizeMultiplier={fontScale.FIXED_MAX} style={{ fontSize, fontWeight: '600', color }}>
      {GLYPHS[name]}
    </Text>
  );
}
