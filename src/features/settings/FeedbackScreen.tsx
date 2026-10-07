/** „Wyślij uwagę” (D80): tekst od osoby + wersja aplikacji; limit dzienny pilnuje serwer. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text } from 'react-native';

import { useServices } from '../../app/context';
import { appVersion } from '../../app/diagnostics';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, Field, Screen, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<RootStackParams, 'Feedback'>;

export function FeedbackScreen({ navigation }: Props) {
  const { account } = useServices();
  const { c, font } = useTheme();
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'limit' | 'error'>('idle');
  const send = () => {
    setState('busy');
    account
      .sendFeedback({ message: text.trim(), screen: 'Settings', appVersion: appVersion() })
      .then(
        () => (setState('sent'), setText('')),
        (e: unknown) => setState(String((e as Error)?.message ?? '').includes('rate_limited') ? 'limit' : 'error'),
      );
  };
  return (
    <Screen testID="screen-feedback">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings['feedback.title']}</Title>
      <Body muted>{strings['feedback.info']}</Body>
      <Field label={strings['feedback.field']} value={text} onChangeText={(v) => (setText(v.slice(0, config.feedback.MAX_LENGTH)), setState('idle'))} multiline testID="feedback-text" />
      <Button label={strings['feedback.send']} testID="feedback-send" disabled={state === 'busy' || text.trim() === ''} onPress={send} />
      {state === 'sent' ? <Body>{strings['feedback.sent']}</Body> : null}
      {state === 'limit' || state === 'error' ? (
        <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>
          {strings[state === 'limit' ? 'feedback.limit' : 'feedback.error']}
        </Text>
      ) : null}
    </Screen>
  );
}
