/** „Wyślij uwagę” (D80): tekst od osoby + wersja aplikacji; limit dzienny pilnuje serwer. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';

import { useServices } from '../../app/context';
import { appVersion } from '../../app/diagnostics';
import { DraftNote, useFormDraft } from '../../app/form-draft';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, ErrorText, Field, Screen, StatusText, Title } from '../../ui/components';

type Props = NativeStackScreenProps<RootStackParams, 'Feedback'>;

export function FeedbackScreen({ navigation }: Props) {
  const { account } = useServices();
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'limit' | 'error' | 'empty'>('idle');
  // Audyt 3 (Q31 A, N-143): szkic uwagi jak w innych formularzach (D179) — wyjście z ekranu nie gubi wpisanego tekstu.
  const draft = useFormDraft('feedback', { text }, { text: setText });
  const send = () => {
    setState('busy');
    account
      .sendFeedback({ message: text.trim(), screen: 'Settings', appVersion: appVersion() })
      .then(
        () => (draft.saved(), setState('sent'), setText('')),
        (e: unknown) => setState(String((e as Error)?.message ?? '').includes('rate_limited') ? 'limit' : 'error'),
      );
  };
  return (
    <Screen testID="screen-feedback">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings['feedback.title']}</Title>
      <Body muted>{strings['feedback.info']}</Body>
      {state === 'sent' ? null : <DraftNote draft={draft} />}
      {/* Audyt 3 (N-143): limit pola zamiast cichego obcinania — przy limicie napis „Najwyżej N znaków.” (Field). */}
      <Field label={strings['feedback.field']} value={text} onChangeText={(v) => (setText(v), setState('idle'))} multiline maxLength={config.feedback.MAX_LENGTH} testID="feedback-text" />
      {state === 'empty' ? <ErrorText testID="feedback-empty">{strings['feedback.empty']}</ErrorText> : null}
      {/* PWD-5 A (M-274): pusty tekst — komunikat po naciśnięciu zamiast wyszarzonego przycisku. */}
      <Button label={strings['feedback.send']} testID="feedback-send" busy={state === 'busy'} onPress={() => (text.trim() === '' ? setState('empty') : send())} />
      {state === 'sent' ? <StatusText>{strings['feedback.sent']}</StatusText> : null}
      {state === 'limit' || state === 'error' ? (
        <ErrorText>{strings[state === 'limit' ? 'feedback.limit' : 'feedback.error']}</ErrorText>
      ) : null}
    </Screen>
  );
}
