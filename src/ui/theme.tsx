/**
 * Motyw w React: paleta jasna albo ciemna i kroje z src/config/theme.ts. Wygląd wybiera osoba w Ustawieniach
 * (D69: Jak w iPhonie / Jasny / Ciemny, zapamiętany na telefonie); „Jak w iPhonie” = useColorScheme.
 * Testy podają tryb wprost (`scheme`), żeby sprawdzić oba.
 *
 * Audyt 2:
 *  - M-139: wybór z aplikacji obowiązuje też okna systemowe (Alert, klawiatura) i pasek stanu. Appearance.setColorScheme
 *    (https://reactnative.dev/docs/appearance — „Forces the application to always adopt a light or dark interface style.
 *    The change applies to the application and all native elements within it (Alerts, Pickers, etc.)”; „Jak w iPhonie”
 *    zdejmuje wymuszenie wartością 'unspecified' z typów RN 0.86), a pasek stanu ma styl według trybu, nie systemu.
 *  - M-266: „Pogrubiony tekst” w iOS. Kroje wybieramy po nazwie pliku, więc system sam ich nie pogrubia — przy włączonym
 *    ustawieniu bierzemy grubszy plik (400 → 600, 600 → 700, nagłówki 700 → 800). AccessibilityInfo
 *    (https://reactnative.dev/docs/accessibilityinfo): „isBoldTextEnabled() … The result is true when bold text is
 *    enabled”, „boldTextChanged — Fires when the state of the bold text toggle changes”.
 *  - M-148 (D197): „Zwiększ kontrast” — AccessibilityInfo.isDarkerSystemColorsEnabled i zdarzenie
 *    darkerSystemColorsChanged (typy RN 0.86, Libraries/Components/AccessibilityInfo/AccessibilityInfo.d.ts) to
 *    UIAccessibility.isDarkerSystemColorsEnabled: „A Boolean value that indicates whether the Increase Contrast setting is
 *    in an enabled state” (https://developer.apple.com/documentation/uikit/uiaccessibility/isdarkersystemcolorsenabled).
 *    Paleta z wyraźniejszymi obwódkami: src/config/theme.ts highContrast.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Appearance as RNAppearance, StatusBar, useColorScheme } from 'react-native';

import { fontScale, groupLines, layout, type Palette, paletteOf, radius, type Scheme, sizes, space } from '../config/theme';

const regular = {
  display800: 'BricolageGrotesque_800ExtraBold',
  display700: 'BricolageGrotesque_700Bold',
  text400: 'AtkinsonHyperlegibleNext_400Regular',
  text600: 'AtkinsonHyperlegibleNext_600SemiBold',
  text700: 'AtkinsonHyperlegibleNext_700Bold',
};

export type Fonts = typeof regular;
/** Kroje przy „Pogrubionym tekście” (M-266): każda rola o stopień grubiej; 700 zostaje (nie ładujemy 800 tekstu). */
const bolder: Fonts = {
  display800: regular.display800,
  display700: regular.display800,
  text400: regular.text600,
  text600: regular.text700,
  text700: regular.text700,
};
export const fontFamily: Readonly<Fonts> = regular;

export type Theme = {
  scheme: Scheme;
  c: Palette;
  line: (index: number) => { line: string; ink: string };
  font: Fonts;
  size: typeof sizes;
  radius: typeof radius;
  space: typeof space;
  layout: typeof layout;
  fontScale: typeof fontScale;
  /** Ustawienia dostępności iOS, z którymi narysowano motyw. */
  bold: boolean;
  increasedContrast: boolean;
};

export type A11yPrefs = { bold: boolean; increasedContrast: boolean };
const noPrefs: A11yPrefs = { bold: false, increasedContrast: false };

export function makeTheme(scheme: Scheme, prefs: A11yPrefs = noPrefs): Theme {
  return {
    scheme,
    c: paletteOf(scheme, prefs.increasedContrast),
    line: (i) => groupLines[((i % groupLines.length) + groupLines.length) % groupLines.length]![scheme],
    font: prefs.bold ? bolder : regular,
    size: sizes,
    radius,
    space,
    layout,
    fontScale,
    bold: prefs.bold,
    increasedContrast: prefs.increasedContrast,
  };
}

const readBold = () => AccessibilityInfo.isBoldTextEnabled();
const readContrast = () => AccessibilityInfo.isDarkerSystemColorsEnabled();

/** Ustawienie dostępności iOS z AccessibilityInfo: wartość przy starcie i każda zmiana. */
function useA11ySetting(read: () => Promise<boolean>, event: 'boldTextChanged' | 'darkerSystemColorsChanged'): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    read().then((v) => live && setOn(v), () => {});
    const sub = AccessibilityInfo.addEventListener(event, (v: boolean) => setOn(v));
    return () => {
      live = false;
      sub.remove();
    };
  }, [read, event]);
  return on;
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
  // M-139: okna systemowe i klawiatura idą za wyborem w aplikacji.
  useEffect(() => RNAppearance.setColorScheme(appearance === 'system' ? 'unspecified' : appearance), [appearance]);
  const bold = useA11ySetting(readBold, 'boldTextChanged');
  const increasedContrast = useA11ySetting(readContrast, 'darkerSystemColorsChanged');
  const s: Scheme = scheme ?? (appearance === 'system' ? (system === 'dark' ? 'dark' : 'light') : appearance);
  const theme = useMemo(() => makeTheme(s, { bold, increasedContrast }), [s, bold, increasedContrast]);
  // M-139: jasne ikony paska stanu na ciemnym motywie i odwrotnie — według trybu aplikacji, nie systemu
  // (https://reactnative.dev/docs/statusbar#setbarstyle — „Set the status bar style”).
  useEffect(() => StatusBar.setBarStyle(s === 'dark' ? 'light-content' : 'dark-content', true), [s]);
  const api = useMemo(() => ({ appearance, setAppearance }), [appearance, setAppearance]);
  return (
    <AppearanceContext.Provider value={api}>
      <ThemeContext.Provider value={theme}>
        {children}
      </ThemeContext.Provider>
    </AppearanceContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
export const useAppearance = () => useContext(AppearanceContext);
