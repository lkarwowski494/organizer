/**
 * Prośba o powiadomienia na „Moje sprawy” (D70, D75; ADR 0015, 0016): przypomnienia dotyczą każdego, więc karta
 * pokazuje się, dopóki nie zapytaliśmy. Zgoda w oknie systemowym; „Nie teraz” chowa prośbę na tym telefonie.
 */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { useServices } from '../../app/context';
import { registerIfAllowed } from '../../app/push';
import { strings } from '../../i18n/strings.pl';
import { Body, Button } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function PushPrompt() {
  const { push, account } = useServices();
  const { c, font } = useTheme();
  const [show, setShow] = useState(false);
  useEffect(() => {
    let live = true;
    if (!push) return;
    Promise.all([push.status(), push.dismissed()])
      .then(([s, d]) => live && setShow(s === 'undetermined' && !d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [push]);
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
