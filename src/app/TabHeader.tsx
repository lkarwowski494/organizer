/**
 * Górny pasek każdej zakładki (decyzja właściciela 8.10.2026, PW-28 A / audyt 2 M-127, D188): stan synchronizacji tylko
 * informuje (tekst czytany przez VoiceOver jako „Stan synchronizacji: …”), a wejście do Ustawień to osobna ikona
 * w prawym górnym rogu — ta sama na Moich sprawach, Listach, Kalendarzu i Grupach (wcześniej ukryta w chipie na jednej
 * zakładce). `usePullRefresh` — „przeciągnij, by odświeżyć” (PWD-10 A) z tym samym stanem pobierania.
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { config } from '../config';
import { strings } from '../i18n/strings.pl';
import { SyncChip } from '../ui/components';
import { useTheme } from '../ui/theme';
import { useAppData, useServices } from './context';
import type { RootStackParams } from './routes';

export function TabHeader() {
  const { nowMs } = useServices();
  const { indicator } = useAppData();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { c, size } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <View style={{ flexShrink: 1 }}>
        <SyncChip indicator={indicator} nowMs={nowMs()} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings['settings.open']}
        testID="open-settings"
        onPress={() => nav.navigate('Settings')}
        style={{ width: size.TOUCH_TARGET, height: size.TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', borderRadius: size.TOUCH_TARGET / 2, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}
      >
        {/* U+2699 z selektorem tekstowym U+FE0E — znak, nie emoji (kolor tekstu motywu). */}
        <Text style={{ fontSize: 22, lineHeight: 26, color: c.ink }}>{'⚙︎'}</Text>
      </Pressable>
    </View>
  );
}

/**
 * Odświeżenie gestem: pobranie zmian teraz (store.refresh) i kółko, dopóki wskaźnik mówi „Synchronizuję…”, ale nie
 * krócej niż config.sync.REFRESH_SPIN_MS — inaczej przy szybkim pobraniu gest nie dawałby żadnego znaku.
 */
export function usePullRefresh() {
  const { store } = useServices();
  const { indicator } = useAppData();
  const [spinning, setSpinning] = useState(false);
  const [pulled, setPulled] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  return {
    refreshing: spinning || (pulled && indicator.state === 'syncing'),
    onRefresh: () => {
      stop.current?.();
      setSpinning(true);
      setPulled(true);
      store.refresh();
      const timer = setTimeout(() => {
        setSpinning(false);
        // Po najkrótszym czasie czekamy, aż pobieranie się skończy (wskaźnik przestaje mówić „Synchronizuję…”).
        const done = () => store.getSnapshot().indicator.state !== 'syncing';
        if (done()) return setPulled(false);
        const unsubscribe = store.subscribe(() => {
          if (!done()) return;
          unsubscribe();
          setPulled(false);
        });
        stop.current = unsubscribe;
      }, config.sync.REFRESH_SPIN_MS);
      stop.current = () => clearTimeout(timer);
    },
  };
}
