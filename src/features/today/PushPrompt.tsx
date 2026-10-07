/**
 * Prośba o powiadomienia na „Dotyczy mnie” (D70, ADR 0015): tylko gdy jestem we wspólnej grupie (przekazania mają
 * sens) i jeszcze nie pytaliśmy. Zgoda w oknie systemowym; „Nie teraz” chowa prośbę na tym telefonie.
 */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { useServices } from '../../app/context';
import { registerIfAllowed } from '../../app/push';
import { strings } from '../../i18n/strings.pl';
import { Body, Button } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function PushPrompt({ shared }: { shared: boolean }) {
  const { push, account } = useServices();
  const { c, font } = useTheme();
  const [show, setShow] = useState(false);
  useEffect(() => {
    let live = true;
    if (!push || !shared) return;
    Promise.all([push.status(), push.dismissed()])
      .then(([s, d]) => live && setShow(s === 'undetermined' && !d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [push, shared]);
  if (!show || !push) return null;
  return (
    <View testID="push-prompt" style={{ gap: 8, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
      <Text accessibilityRole="header" style={{ fontFamily: font.text700, fontSize: 17, color: c.ink }}>
        {strings['push.title']}
      </Text>
      <Body muted>{strings['push.why']}</Body>
      <Button
        label={strings['push.enable']}
        testID="push-enable"
        onPress={() => {
          setShow(false);
          push
            .request()
            .then((ok) => (ok ? registerIfAllowed(push, (t, e) => account.registerPushToken(t, e)) : false))
            .catch(() => {});
        }}
      />
      <Button
        kind="secondary"
        label={strings['push.later']}
        testID="push-later"
        onPress={() => {
          setShow(false);
          push.dismiss().catch(() => {});
        }}
      />
    </View>
  );
}
