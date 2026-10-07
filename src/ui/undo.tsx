/**
 * Pasek „Cofnij” po usunięciu (zasada produktu: miękkie usuwanie i cofanie, nic nie ginie po jednym dotknięciu).
 * Jeden pasek naraz; nowy zastępuje poprzedni. Znika po config.UNDO_MS albo po „Cofnij”.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { config } from '../config';
import { strings } from '../i18n/strings.pl';
import { useTheme } from './theme';

type Undo = { show: (message: string, onUndo: () => void) => void };
const UndoContext = createContext<Undo>({ show: () => {} });

export function UndoProvider({ children }: { children: ReactNode }) {
  const { c, font, size } = useTheme();
  const insets = useSafeAreaInsets();
  const [bar, setBar] = useState<{ message: string; onUndo: () => void; n: number } | null>(null);
  const n = useRef(0);
  const show = useCallback((message: string, onUndo: () => void) => setBar({ message, onUndo, n: ++n.current }), []);
  useEffect(() => {
    if (!bar) return;
    const t = setTimeout(() => setBar((b) => (b?.n === bar.n ? null : b)), config.UNDO_MS);
    return () => clearTimeout(t);
  }, [bar]);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <UndoContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        {children}
        {bar ? (
          <View
            testID="undo-bar"
            accessibilityLiveRegion="polite"
            style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 6, minHeight: 52, borderRadius: 14, backgroundColor: c.inverseBg }}
          >
            <Text style={{ flex: 1, fontFamily: font.text600, fontSize: size.META, color: c.inverseInk }}>{bar.message}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings['undo.action']}
              onPress={() => {
                bar.onUndo();
                setBar(null);
              }}
              style={{ minHeight: size.TOUCH_TARGET, paddingHorizontal: 14, justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.inverseInk }}>{strings['undo.action']}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </UndoContext.Provider>
  );
}

export const useUndo = (): Undo => useContext(UndoContext);
