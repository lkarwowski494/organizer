/**
 * „Jak masz na imię?” (D100): przy starcie, gdy konto nie ma imienia (logowanie e-mailem), i w Ustawieniach
 * („Twoje imię”). Zapis: profil konta (serwer) i moje członkostwa z dawnym imieniem (kolejka). Logika: domain/views/my-name.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { type NameError, renameMeOps, validateName } from '../../domain/views/my-name';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, ErrorText, Field, Screen, Title } from '../../ui/components';
import { WELCOME_SEEN } from '../welcome/WelcomeScreen';

type Props = NativeStackScreenProps<RootStackParams, 'Name'>;
export const NAME_ASKED = 'nameAsked';

const ERRORS: Record<NameError | 'server', string> = {
  empty: strings['name.error.empty'],
  tooLong: strings['name.error.tooLong'](config.profile.NAME_MAX_LENGTH),
  server: `${strings['common.error']} ${strings['common.offlineOnly']}`,
};

export function NameScreen({ route, navigation }: Props) {
  const { account, store, userId, displayName, emailName, needsName, prefs } = useServices();
  const { tables } = useAppData();
  const asked = route.params?.from !== 'settings';
  const [name, setName] = useState(asked && needsName ? '' : displayName);
  const [error, setError] = useState<NameError | 'server' | null>(null);
  const [busy, setBusy] = useState(false);

  // Po pytaniu przy starcie — wprowadzenie, jeśli to konto jeszcze go nie widziało (D79, D175).
  const close = async () => {
    if (!asked) return navigation.goBack();
    await prefs?.set(NAME_ASKED, '1').catch(() => {});
    const seen = await prefs?.get(WELCOME_SEEN).catch(() => '1');
    if (seen === '1' || seen === undefined) navigation.goBack();
    else navigation.replace('Welcome');
  };
  const save = async () => {
    const e = validateName(name);
    if (e) return setError(e);
    setBusy(true);
    try {
      await account.setMyName(name.trim());
    } catch {
      setBusy(false);
      return setError('server');
    }
    store.dispatch(renameMeOps(tables, userId, name, [displayName, emailName]));
    await close();
  };

  return (
    <Screen testID="screen-name">
      {/* Audyt 2 (M-242): z Ustawień — „Wróć” jak na innych ekranach; przy starcie gest cofania jest wyłączony (navigation.tsx). */}
      {asked ? null : <BackButton onPress={() => navigation.goBack()} />}
      <Title>{asked ? strings['name.askTitle'] : strings['name.title']}</Title>
      <Body muted>{strings['name.info']}</Body>
      <Field label={strings['name.field']} value={name} onChangeText={(v) => (setName(v), setError(null))} autoCapitalize="words" textContentType="givenName" autoComplete="name-given" returnKeyType="done" onSubmitEditing={() => void save()} testID="name-field" />
      {error ? (
        <ErrorText>{ERRORS[error]}</ErrorText>
      ) : null}
      <Button label={strings['name.save']} busy={busy} onPress={() => void save()} testID="name-save" />
      <Button kind="secondary" label={asked ? strings['name.later'] : strings['common.cancel']} onPress={() => void close()} testID="name-later" />
    </Screen>
  );
}
