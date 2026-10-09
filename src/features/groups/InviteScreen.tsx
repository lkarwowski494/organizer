/**
 * Dołączenie do grupy (D92–D94): ID grupy + kod (jak w Zoom), link z ID i kodem albo wklejona wiadomość. Stare
 * zaproszenia z 64-znakowym kodem nadal działają (wklejone albo z linku invite/<token>).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';

import { useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { groupDigits, parseInviteToken, parseJoin } from '../../domain/invite-link';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, ErrorText, Field, Screen, Title } from '../../ui/components';
import { groupErrorText } from './server-errors';

type Props = NativeStackScreenProps<RootStackParams, 'Invite'>;

const only = (s: string) => s.replace(/\D/g, '');

export function InviteScreen({ route, navigation }: Props) {
  const { account, displayName, store } = useServices();
  const p = route.params ?? {};
  const [joinId, setJoinId] = useState(groupDigits(only(p.g ?? '')));
  const [code, setCode] = useState(groupDigits(only(p.c ?? '')));
  const [paste, setPaste] = useState('');
  const [me, setMe] = useState(displayName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Audyt 2 (R-39): wpisane ID i kod mają pierwszeństwo przed starym 64-znakowym kodem z wklejonej wiadomości.
  const typed = only(joinId).length > 0 && only(code).length > 0;
  const legacy = p.token ?? (typed ? null : parseInviteToken(paste));

  const onPaste = (v: string) => {
    setPaste(v);
    setError(null);
    const j = parseJoin(v);
    if (j) {
      setJoinId(groupDigits(j.joinId));
      setCode(groupDigits(j.code));
    }
  };

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const { groupId } = legacy ? await account.acceptInvite(legacy, me.trim()) : await account.joinGroup(only(joinId), only(code), me.trim());
      store.refresh();
      navigation.replace('Group', { groupId, fresh: true });
    } catch (e) {
      setError(groupErrorText(e));
      setBusy(false);
    }
  };
  const ready = !!legacy || typed;

  return (
    <Screen testID="screen-invite">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings['invite.title']}</Title>
      {p.token ? null : (
        <>
          <Body muted>{strings['invite.body']}</Body>
          <Field label={strings['invite.joinId']} value={joinId} onChangeText={(v) => (setJoinId(v), setError(null))} keyboardType="number-pad" testID="invite-join-id" />
          <Field label={strings['invite.code']} value={code} onChangeText={(v) => (setCode(v), setError(null))} keyboardType="number-pad" testID="invite-code" />
          <Field label={strings['invite.paste']} value={paste} onChangeText={onPaste} autoCapitalize="none" autoCorrect={false} multiline testID="invite-input" />
        </>
      )}
      <Field label={strings['groups.myName']} value={me} onChangeText={setMe} maxLength={config.profile.NAME_MAX_LENGTH} textContentType="givenName" autoComplete="name-given" testID="invite-name" />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label={strings['invite.accept']} onPress={accept} disabled={me.trim() === '' || !ready} busy={busy} testID="invite-accept" />
    </Screen>
  );
}
