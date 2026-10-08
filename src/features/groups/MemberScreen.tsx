/**
 * Osoba w grupie: imię (także dziecka), rola (admin, członek, dziecko — osobom z kontem zmienia ją owner), usunięcie
 * z grupy, przekazanie własności (D55), połączenie profilu dziecka z kontem dziecka (PW-14 B).
 * Co wolno — src/domain/views memberActions (zgodnie ze strażnikiem członkostw po stronie serwera).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import type { JoinInvite } from '../../sync/account';
import { remove, renameMember, restore, setRole } from '../../domain/views/commands';
import { type NameError, validateName } from '../../domain/views/my-name';
import { groupDetail, memberActions, type MemberActions } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, ErrorText, Field, Screen, Segmented, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { useUndo } from '../../ui/undo';
import { useLiveText } from '../../ui/live-text';
import { JoinCodeCard } from './JoinCodeCard';
import { groupErrorText } from './server-errors';

type Props = NativeStackScreenProps<RootStackParams, 'Member'>;

/** Komunikaty jak na ekranie „Twoje imię” (NameScreen). */
const NAME_ERRORS: Record<NameError, string> = {
  empty: strings['name.error.empty'],
  tooLong: strings['name.error.tooLong'](config.profile.NAME_MAX_LENGTH),
};

const NONE: MemberActions = { rename: false, setRole: false, remove: false, makeOwner: false, link: false };

export function MemberScreen({ route, navigation }: Props) {
  const { userId, store, account } = useServices();
  const { tables, today } = useAppData();
  const { c, font } = useTheme();
  const d = useMemo(() => groupDetail(tables, userId, route.params.groupId), [tables, userId, route.params.groupId]);
  const m = d?.members.find((x) => x.member_id === route.params.memberId);
  // D130 + audyt 2 (R-36, T-22): imię podąża za danymi, dopóki go nie edytuję; zapis po wyjściu z pola albo z ekranu.
  // Puste albo za długie imię się nie zapisuje — komunikat jak na ekranie „Twoje imię” (PW-20 A). Mechanizm: ui/live-text.
  const name = useLiveText(m?.display_name ?? '', (n) => d && m && memberActions(d, m).rename && store.dispatch(renameMember(m.member_id, n)), {
    validate: (text) => {
      const bad = validateName(text);
      return bad ? NAME_ERRORS[bad] : null;
    },
  });
  const [confirmOwner, setConfirmOwner] = useState(false);
  const undo = useUndo();
  const [error, setError] = useState<string | null>(null);
  // PW-14 B: kod połączenia profilu dziecka z kontem (bieżący ważny albo nowy, jeden na profil).
  const [childCode, setChildCode] = useState<JoinInvite | null>(null);
  // Audyt 2 (R-33): własność przekazana — do pobrania zmian ten ekran czeka, a ekran grupy nie pokazuje opcji właściciela.
  const [transferred, setTransferred] = useState(false);
  // Wracamy, gdy pobranie pokaże, że nie jestem już właścicielem (moja rola, nie rola tej osoby — tę może jeszcze
  // przykrywać moja niewysłana zmiana roli).
  const meOwner = d?.group.me.role === 'owner';
  useEffect(() => {
    if (transferred && !meOwner) navigation.goBack();
  }, [transferred, meOwner, navigation]);

  if (!d || !m) {
    return (
      <Screen testID="screen-member-missing">
        <BackButton onPress={() => navigation.goBack()} />
        <Body muted>{strings['common.error']}</Body>
      </Screen>
    );
  }
  const can = transferred ? NONE : memberActions(d, m);
  const makeChildCode = async (renew = false) => {
    setError(null);
    try {
      setChildCode(await (renew ? account.renewChildCode(m.member_id) : account.createChildCode(m.member_id)));
    } catch (e) {
      setError(groupErrorText(e));
    }
  };
  return (
    <Screen testID="screen-member">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{m.display_name}</Title>
      <Body muted>{[d.group.kind === 'personal' ? strings['groups.personal'] : d.group.name, strings[`groups.role.${m.role}`], ...(m.role === 'child' && m.user_id !== null ? [strings['member.hasAccount']] : [])].join(' · ')}</Body>
      {/* D128: plan lekcji tylko przy dziecku. */}
      {d.group.kind === 'shared' && d.group.me.role !== 'child' && m.role === 'child' ? (
        <Button kind="secondary" label={strings['timetable.open']} testID="open-timetable" onPress={() => navigation.navigate('Timetable', { groupId: d.group.id, memberId: m.member_id })} />
      ) : null}
      {can.rename ? (
        <View style={{ gap: 6 }}>
          <Field label={strings['member.name']} {...name.field} maxLength={config.profile.NAME_MAX_LENGTH} testID="member-name" />
          {name.error ? <ErrorText>{name.error}</ErrorText> : null}
          {/* Audyt 2 (P-67): imię w tej grupie a imię konta — gdzie zmienić to drugie. */}
          {m.user_id === userId ? <Body muted>{strings['member.nameHere']}</Body> : null}
        </View>
      ) : null}
      {can.setRole ? (
        <Segmented
          label={strings['member.role']}
          // setRole tylko dla innej osoby niż ja (owner) — jej rola nie jest „owner”.
          value={m.role as 'admin' | 'member' | 'child'}
          onChange={(r) => store.dispatch(setRole(m.member_id, r))}
          options={[
            { value: 'admin', label: strings['member.roleOption.admin'] },
            { value: 'member', label: strings['member.roleOption.member'] },
            { value: 'child', label: strings['member.roleOption.child'] },
          ]}
        />
      ) : null}
      {can.setRole || (m.role === 'child' && m.user_id !== null) ? <Body muted>{strings['member.childRoleInfo']}</Body> : null}
      {can.link && !childCode ? (
        <View style={{ gap: 8 }}>
          <Body muted>{strings['member.linkAbout'](m.display_name)}</Body>
          <Button kind="secondary" label={strings['member.link']} testID="child-link" onPress={() => void makeChildCode()} />
        </View>
      ) : null}
      {can.link && childCode ? (
        <JoinCodeCard
          code={childCode}
          today={today}
          title={strings['member.linkReady']}
          note={strings['member.linkFor'](m.display_name)}
          info={strings['member.linkInfo']}
          message={(id, code, u) => strings['member.linkMessage'](m.display_name, d.group.name, config.invites.LINK_LIVE ? childCode.url : null, id, code, u, config.invites.TESTFLIGHT_LINK)}
          onRenew={() => void makeChildCode(true)}
          onRevoke={async () => {
            setError(null);
            try {
              await account.revokeInvite(childCode.inviteId);
              setChildCode(null);
            } catch (e) {
              setError(groupErrorText(e));
            }
          }}
          testIDs={{ card: 'child-code-ready', code: 'child-code', renew: 'child-code-new' }}
        />
      ) : null}
      {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>{error}</Text> : null}
      {transferred ? <Body>{strings['member.transferPending']}</Body> : null}
      {confirmOwner && !transferred ? (
        <View style={{ gap: 8 }}>
          <Body>{strings['member.makeOwnerConfirm'](m.display_name)}</Body>
          <Button
            kind="danger"
            label={strings['member.makeOwnerYes']}
            testID="make-owner-confirm"
            onPress={async () => {
              setError(null);
              try {
                await account.transferOwnership(d.group.id, m.member_id);
                setTransferred(true);
                store.refresh();
              } catch (e) {
                setError(groupErrorText(e));
              }
            }}
          />
          <Button kind="secondary" label={strings['common.cancel']} onPress={() => setConfirmOwner(false)} />
        </View>
      ) : can.makeOwner ? (
        <Button kind="secondary" label={strings['member.makeOwner']} onPress={() => setConfirmOwner(true)} testID="make-owner" />
      ) : null}
      {/* Decyzje z 8.10.2026 (PW-35 A, PW-16 A, D165): bez pytania — pasek „Cofnij” przywraca osobę (ten sam member_id,
          więc wracają plan lekcji, obecność i zadania); owner/admin może ją przywrócić przez config.sync.TOMBSTONE_DAYS dni
          (kosz osób na ekranie Grupy, D151). */}
      {can.remove ? (
        <Button
          kind="danger"
          label={strings['member.remove']}
          testID="remove-member"
          onPress={() => {
            // Niezapisane imię osoby usuniętej przepada (serwer i tak nie zmienia usuniętych).
            name.drop();
            const op = remove('group_members', m.member_id);
            store.dispatch(op);
            navigation.goBack();
            undo.show(strings['undo.memberRemoved'](m.display_name), { ops: [restore('group_members', m.member_id)] }, { changed: [op] });
          }}
        />
      ) : null}
    </Screen>
  );
}
