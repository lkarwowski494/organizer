/**
 * Prośba o powiadomienia na „Moje sprawy” (D70, D75; ADR 0015, 0016): przypomnienia dotyczą każdego, więc karta
 * pokazuje się, dopóki nie zapytaliśmy. Zgoda w oknie systemowym; „Nie teraz” chowa prośbę dla tego konta (D175) —
 * włączyć można potem w Ustawieniach → Powiadomienia (audyt 2, N-8). Zgoda i jej skutki (token, plan przypomnień)
 * w jednym miejscu: RemindersProvider.enable — ten sam przycisk w Ustawieniach robi to samo.
 */
import { useEffect, useState } from 'react';

import { PUSH_DISMISSED } from '../../app/account-prefs';
import { useServices } from '../../app/context';
import { useReminderSettings } from '../../app/reminders';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, Card, CardTitle } from '../../ui/components';

export function PushPrompt() {
  const { push, prefs } = useServices();
  const { status, enable } = useReminderSettings();
  // Bez pamięci ustawień (np. testy) nic nie odłożono.
  const [dismissed, setDismissed] = useState<boolean | null>(prefs ? null : false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let live = true;
    if (!prefs) return;
    prefs
      .get(PUSH_DISMISSED)
      .then((d) => live && setDismissed(d === '1'))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [prefs]);
  if (!push || hidden || dismissed !== false || status !== 'undetermined') return null;
  return (
    <Card testID="push-prompt">
      <CardTitle>
        {strings['push.title']}
      </CardTitle>
      <Body muted>{strings['push.why']}</Body>
      <Button
        label={strings['push.enable']}
        testID="push-enable"
        onPress={() => {
          setHidden(true);
          void enable();
        }}
      />
      <Button
        kind="secondary"
        label={strings['push.later']}
        testID="push-later"
        onPress={() => {
          setHidden(true);
          prefs?.set(PUSH_DISMISSED, '1').catch(() => {});
        }}
      />
    </Card>
  );
}
