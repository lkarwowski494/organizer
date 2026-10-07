/**
 * Motyw w React: paleta jasna albo ciemna według ustawienia iPhone'a (useColorScheme) i kroje z
 * src/config/theme.ts. Testy podają tryb wprost (`scheme`), żeby sprawdzić oba.
 */
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { groupLines, type Palette, palettes, type Scheme, sizes } from '../config/theme';

export const fontFamily = {
  display800: 'SchibstedGrotesk_800ExtraBold',
  display700: 'SchibstedGrotesk_700Bold',
  text400: 'AtkinsonHyperlegibleNext_400Regular',
  text600: 'AtkinsonHyperlegibleNext_600SemiBold',
  text700: 'AtkinsonHyperlegibleNext_700Bold',
} as const;

export type Theme = {
  scheme: Scheme;
  c: Palette;
  line: (index: number) => { line: string; ink: string };
  font: typeof fontFamily;
  size: typeof sizes;
};

export function makeTheme(scheme: Scheme): Theme {
  return {
    scheme,
    c: palettes[scheme],
    line: (i) => groupLines[((i % groupLines.length) + groupLines.length) % groupLines.length]![scheme],
    font: fontFamily,
    size: sizes,
  };
}

const ThemeContext = createContext<Theme>(makeTheme('light'));

export function ThemeProvider({ scheme, children }: { scheme?: Scheme; children: ReactNode }) {
  const system = useColorScheme();
  const s: Scheme = scheme ?? (system === 'dark' ? 'dark' : 'light');
  const theme = useMemo(() => makeTheme(s), [s]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
