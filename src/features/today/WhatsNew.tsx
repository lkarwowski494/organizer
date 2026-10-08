/**
 * Karta „Co nowego” na „Dotyczy mnie” (D84, ADR 0018): raz po aktualizacji, punkty z i18n/whats-new.pl.ts.
 * „OK” zamyka na tym telefonie; „Wyślij uwagę” otwiera formularz uwag (D80) i też zamyka.
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { useServices } from '../../app/context';
import { buildNumber } from '../../app/diagnostics';
import type { RootStackParams } from '../../app/routes';
import { whatsNew } from '../../domain/whats-new';
import { strings } from '../../i18n/strings.pl';
import { whatsNewEntries } from '../../i18n/whats-new.pl';
import { Body, Button } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { WELCOME_SEEN } from '../welcome/WelcomeScreen';

export const WHATS_NEW_SEEN = 'whatsNewBuild';

export function WhatsNew() {
  const { prefs } = useServices();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { c, font } = useTheme();
  const [items, setItems] = useState<readonly string[] | null>(null);
  const build = buildNumber();
  useEffect(() => {
    let live = true;
    if (!prefs) return;
    Promise.all([prefs.get(WHATS_NEW_SEEN), prefs.get(WELCOME_SEEN)])
      .then(([seen, welcome]) => {
        const d = whatsNew(whatsNewEntries, build, seen === null ? null : Number(seen), welcome === '1');
        if (d.remember !== null) void prefs.set(WHATS_NEW_SEEN, String(d.remember)).catch(() => {});
        if (live) setItems(d.show);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [prefs, build]);
  if (!items || !prefs) return null;
  const close = () => {
    setItems(null);
    prefs.set(WHATS_NEW_SEEN, String(build)).catch(() => {});
  };
  return (
    <View testID="whats-new" style={{ gap: 8, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
      <Text accessibilityRole="header" style={{ fontFamily: font.text700, fontSize: 17, color: c.ink }}>
        {strings['whatsNew.title']}
      </Text>
      {items.map((t) => (
        <Body key={t}>{`• ${t}`}</Body>
      ))}
      <Button label={strings['whatsNew.ok']} testID="whats-new-ok" onPress={close} />
      <Button
        kind="secondary"
        label={strings['whatsNew.feedback']}
        testID="whats-new-feedback"
        onPress={() => {
          close();
          nav.navigate('Feedback');
        }}
      />
    </View>
  );
}
