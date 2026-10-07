/** Przyjęcie zaproszenia: z linku głębokiego (token w trasie) albo z wklejonego linku/kodu. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text } from 'react-native';

import { useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { parseInviteToken } from '../../domain/invite-link';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, Field, Screen, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<RootStackParams, 'Invite'>;

export function InviteScreen({ route, navigation }: Props) {
  const { account, displayName, store } = useServices();
  const { c, font } = useTheme();
  const [input, setInput] = useState(route.params?.token ?? '');
  const [me, setMe] = useState(displayName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = parseInviteToken(input);

  const accept = async () => {
    if (!token) return setError(strings['invite.invalid']);
    setBusy(true);
    setError(null);
    try {
      const { groupId } = await account.acceptInvite(token, me.trim());
      store.refresh();
      navigation.replace('Group', { groupId });
    } catch (e) {
      // Kody serwera: invite_invalid / invite_revoked / invite_expired / invite_used_up → jeden komunikat.
      setError(String((e as Error).message).startsWith('invite_') ? strings['invite.invalid'] : `${strings['common.error']} ${strings['common.offlineOnly']}`);
      setBusy(false);
    }
  };

  return (
    <Screen testID="screen-invite">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings['invite.title']}</Title>
      <Body muted>{strings['invite.body']}</Body>
      {route.params?.token ? null : <Field label={strings['invite.paste']} value={input} onChangeText={setInput} autoCapitalize="none" autoCorrect={false} testID="invite-input" />}
      <Field label={strings['groups.myName']} value={me} onChangeText={setMe} testID="invite-name" />
      {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>{error}</Text> : null}
      <Button label={strings['invite.accept']} onPress={accept} disabled={busy || me.trim() === '' || input.trim() === ''} testID="invite-accept" />
    </Screen>
  );
}
