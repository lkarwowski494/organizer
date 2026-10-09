/**
 * Dołączenie do grupy (D92–D94): ID grupy + kod (jak przy dołączaniu do wideospotkania), link z ID i kodem albo wklejona wiadomość. Stare
 * zaproszenia z 64-znakowym kodem nadal działają (wklejone albo z linku invite/<token>).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';

import { useServices } from '../../app/context';
import { useDefaultGroup } from '../../app/default-group';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { groupDigits, parseInviteToken, parseJoin } from '../../domain/invite-link';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, ErrorText, Field, Screen, StatusText, Title } from '../../ui/components';
import { groupErrorText } from './server-errors';

type Props = NativeStackScreenProps<RootStackParams, 'Invite'>;

const only = (s: string) => s.replace(/\D/g, '');

/**
 * Kod na wyższą rolę niż moja nie podnosi jej (audyt 3, N-157; serwer: accept_invite) — wtedy komunikat podaje moją rolę.
 * Role spoza listy (np. serwer bez ról) — bez roli w komunikacie.
 */
const ROLES = ['child', 'member', 'admin', 'owner'] as const;
function lowerRole(role: string | null, inviteRole: string | null): (typeof ROLES)[number] | null {
  const mine = ROLES.findIndex((r) => r === role);
  return mine >= 0 && ROLES.findIndex((r) => r === inviteRole) > mine ? ROLES[mine]! : null;
}

export function InviteScreen({ route, navigation }: Props) {
  const { account, displayName, needsName, store } = useServices();
  const defaultGroup = useDefaultGroup();
  const p = route.params ?? {};
  const [joinId, setJoinId] = useState(groupDigits(only(p.g ?? '')));
  const [code, setCode] = useState(groupDigits(only(p.c ?? '')));
  const [paste, setPaste] = useState('');
  // Audyt 3 (N-164): konto bez imienia — pole puste (bez „Ja” i początku adresu). Niezmienione imię z konta nie idzie na
  // serwer: zostaje imię profilu konta, dawne imię w tej grupie albo imię profilu dziecka nadane przez rodzica.
  const [me, setMe] = useState(needsName ? '' : displayName);
  const [nameEdited, setNameEdited] = useState(false);
  const [already, setAlready] = useState<{ groupId: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Audyt 2 (R-39): wpisane ID i kod mają pierwszeństwo przed starym 64-znakowym kodem z wklejonej wiadomości.
  const typed = only(joinId).length > 0 && only(code).length > 0;
  const legacy = p.token ?? (typed ? null : parseInviteToken(paste));

  const onPaste = (v: string) => {
    setPaste(v);
    setError(null);
    setAlready(null);
    const j = parseJoin(v);
    if (j) {
      setJoinId(groupDigits(j.joinId));
      setCode(groupDigits(j.code));
    }
  };

  // PWD-5 A (M-274): przycisk aktywny (poza wysyłaniem) — po naciśnięciu komunikat, czego brakuje.
  const accept = async () => {
    if (!ready) return setError(strings['invite.error.missing']);
    if (me.trim() === '') return setError(strings['groups.error.myNameEmpty']);
    setBusy(true);
    setError(null);
    try {
      const name = needsName || nameEdited ? me.trim() : null;
      const { groupId, alreadyMember } = legacy ? await account.acceptInvite(legacy, name) : await account.joinGroup(only(joinId), only(code), name);
      if (alreadyMember) {
        const mine = lowerRole(alreadyMember.role, alreadyMember.inviteRole);
        setAlready({ groupId, text: strings['invite.alreadyMember'](mine && strings[`groups.role.${mine}`]) });
        setBusy(false);
        return;
      }
      // Audyt 3 (N-45, Q14 A): dołączona grupa zostaje ostatnio użytą, jak nowo utworzona (NewGroupScreen).
      defaultGroup.remember(groupId);
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
          <Field label={strings['invite.joinId']} value={joinId} onChangeText={(v) => (setJoinId(v), setError(null), setAlready(null))} keyboardType="number-pad" testID="invite-join-id" />
          <Field label={strings['invite.code']} value={code} onChangeText={(v) => (setCode(v), setError(null), setAlready(null))} keyboardType="number-pad" testID="invite-code" />
          <Field label={strings['invite.paste']} value={paste} onChangeText={onPaste} autoCapitalize="none" autoCorrect={false} multiline testID="invite-input" />
        </>
      )}
      <Field label={strings['groups.myName']} value={me} onChangeText={(v) => (setMe(v), setNameEdited(true), setError(null))} placeholder={strings['groups.myName.placeholder']} maxLength={config.profile.NAME_MAX_LENGTH} textContentType="givenName" autoComplete="name-given" returnKeyType="join" onSubmitEditing={() => void accept()} testID="invite-name" />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {already ? (
        <>
          <StatusText>{already.text}</StatusText>
          <Button label={strings['invite.openGroup']} onPress={() => navigation.replace('Group', { groupId: already.groupId })} testID="invite-open-group" />
        </>
      ) : (
        <Button label={strings['invite.accept']} onPress={accept} busy={busy} testID="invite-accept" />
      )}
    </Screen>
  );
}
