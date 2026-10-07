/**
 * Motyw w React: paleta jasna albo ciemna i kroje z src/config/theme.ts. Wygląd wybiera osoba w Ustawieniach
 * (D69: Jak w iPhonie / Jasny / Ciemny, zapamiętany na telefonie); „Jak w iPhonie” = useColorScheme.
 * Testy podają tryb wprost (`scheme`), żeby sprawdzić oba.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { groupLines, type Palette, palettes, type Scheme, sizes } from '../config/theme';

export const fontFamily = {
  display800: 'BricolageGrotesque_800ExtraBold',
  display700: 'BricolageGrotesque_700Bold',
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

export type Appearance = 'system' | 'light' | 'dark';
/** Gdzie zapamiętać wybór (w aplikacji: pęk kluczy; w testach: pamięć). */
export type AppearanceStore = { load(): Promise<string | null>; save(a: Appearance): Promise<void> };
type AppearanceApi = { appearance: Appearance; setAppearance: (a: Appearance) => void };
const AppearanceContext = createContext<AppearanceApi>({ appearance: 'system', setAppearance: () => {} });
const isAppearance = (v: unknown): v is Appearance => v === 'system' || v === 'light' || v === 'dark';

export function ThemeProvider({ scheme, store, children }: { scheme?: Scheme; store?: AppearanceStore; children: ReactNode }) {
  const system = useColorScheme();
  const [appearance, setPref] = useState<Appearance>('system');
  useEffect(() => {
    let live = true;
    store?.load().then((v) => live && isAppearance(v) && setPref(v)).catch(() => {});
    return () => {
      live = false;
    };
  }, [store]);
  const setAppearance = useCallback(
    (a: Appearance) => {
      setPref(a);
      store?.save(a).catch(() => {});
    },
    [store],
  );
  const s: Scheme = scheme ?? (appearance === 'system' ? (system === 'dark' ? 'dark' : 'light') : appearance);
  const theme = useMemo(() => makeTheme(s), [s]);
  const api = useMemo(() => ({ appearance, setAppearance }), [appearance, setAppearance]);
  return (
    <AppearanceContext.Provider value={api}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </AppearanceContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
export const useAppearance = () => useContext(AppearanceContext);
