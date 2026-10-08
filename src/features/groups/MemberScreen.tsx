/**
 * Osoba w grupie: imię (także dziecka), rola admin/członek, usunięcie z grupy, przekazanie własności (D55).
 * Co wolno — src/domain/views memberActions (zgodnie ze strażnikiem członkostw po stronie serwera).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { remove, renameMember, restore, setRole } from '../../domain/views/commands';
import { type NameError, validateName } from '../../domain/views/my-name';
import { groupDetail, type GroupDetail, type Member, memberActions, type MemberActions } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, Field, Screen, Segmented, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { useUndo } from '../../ui/undo';
import { groupErrorText } from './server-errors';

type Props = NativeStackScreenProps<RootStackParams, 'Member'>;

/** D130: zmiana imienia do zapisu — tylko edytowane, poprawne (validateName) i inne niż w danych. */
function renameOp(d: GroupDetail | null, m: Member | undefined, edit: string | null) {
  if (!d || !m || edit === null || validateName(edit) || !memberActions(d, m).rename) return null;
  const n = edit.trim();
  return n !== m.display_name ? renameMember(m.member_id, n) : null;
}

/** Komunikaty jak na ekranie „Twoje imię” (NameScreen). */
const NAME_ERRORS: Record<NameError, string> = {
  empty: strings['name.error.empty'],
  tooLong: strings['name.error.tooLong'](config.profile.NAME_MAX_LENGTH),
};

const NONE: MemberActions = { rename: false, setRole: false, remove: false, makeOwner: false };

export function MemberScreen({ route, navigation }: Props) {
  const { userId, store, account } = useServices();
  const { tables } = useAppData();
  const { c, font } = useTheme();
  const d = useMemo(() => groupDetail(tables, userId, route.params.groupId), [tables, userId, route.params.groupId]);
  const m = d?.members.find((x) => x.member_id === route.params.memberId);
  // D130 + audyt 2 (R-36, T-22): imię podąża za danymi, dopóki go nie edytuję; zapis po wyjściu z pola albo z ekranu.
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [nameError, setNameError] = useState<NameError | null>(null);
  const [confirmOwner, setConfirmOwner] = useState(false);
  const undo = useUndo();
  const [error, setError] = useState<string | null>(null);
  // Audyt 2 (R-33): własność przekazana — do pobrania zmian ten ekran czeka, a ekran grupy nie pokazuje opcji właściciela.
  const [transferred, setTransferred] = useState(false);
  const latest = useRef({ nameEdit, d, m });
  useEffect(() => {
    latest.current = { nameEdit, d, m };
  });
  useEffect(
    () => () => {
      const op = renameOp(latest.current.d, latest.current.m, latest.current.nameEdit);
      if (op) store.dispatch(op);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
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
  // Decyzja właściciela z 8.10.2026 (audyt 2, PW-20 A): pustego (albo za długiego) imienia nie zapisujemy — komunikat.
  const commitName = () => {
    if (nameEdit === null) return;
    const invalid = validateName(nameEdit);
    if (invalid) return setNameError(invalid);
    const op = renameOp(d, m, nameEdit);
    if (op) store.dispatch(op);
    // Zapisane — zamknięcie ekranu przed odświeżeniem nie wyśle tej zmiany drugi raz.
    latest.current = { ...latest.current, nameEdit: null };
    setNameEdit(null);
  };

  return (
    <Screen testID="screen-member">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{m.display_name}</Title>
      <Body muted>{`${d.group.kind === 'personal' ? strings['groups.personal'] : d.group.name} · ${strings[`groups.role.${m.role}`]}`}</Body>
      {/* D128: plan lekcji tylko przy dziecku. */}
      {d.group.kind === 'shared' && d.group.me.role !== 'child' && m.role === 'child' ? (
        <Button kind="secondary" label={strings['timetable.open']} testID="open-timetable" onPress={() => navigation.navigate('Timetable', { groupId: d.group.id, memberId: m.member_id })} />
      ) : null}
      {can.rename ? (
        <View style={{ gap: 6 }}>
          <Field label={strings['member.name']} value={nameEdit ?? m.display_name} onChangeText={(v) => (setNameEdit(v), setNameError(null))} onBlur={commitName} onSubmitEditing={commitName} maxLength={config.profile.NAME_MAX_LENGTH} testID="member-name" />
          {nameError ? <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>{NAME_ERRORS[nameError]}</Text> : null}
        </View>
      ) : null}
      {can.setRole ? (
        <Segmented
          label={strings['member.role']}
          value={m.role}
          onChange={(r) => store.dispatch(setRole(m.member_id, r as 'admin' | 'member'))}
          options={[
            { value: 'admin', label: strings['groups.role.admin'] },
            { value: 'member', label: strings['groups.role.member'] },
          ]}
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
            latest.current = { ...latest.current, nameEdit: null };
            setNameEdit(null);
            const op = remove('group_members', m.member_id);
            store.dispatch(op);
            navigation.goBack();
            undo.show(strings['undo.memberRemoved'](m.display_name), () => store.dispatch(restore('group_members', m.member_id)), { changed: [op] });
          }}
        />
      ) : null}
    </Screen>
  );
}
