/**
 * Osoba w grupie: imię (także dziecka), rola admin/członek, usunięcie z grupy, przekazanie własności (D55).
 * Co wolno — src/domain/views memberActions (zgodnie ze strażnikiem członkostw po stronie serwera).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { remove, renameMember, setRole } from '../../domain/views/commands';
import { groupDetail, memberActions } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, Field, Screen, Segmented, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<RootStackParams, 'Member'>;

export function MemberScreen({ route, navigation }: Props) {
  const { userId, store, account } = useServices();
  const { tables } = useAppData();
  const { c, font } = useTheme();
  const d = useMemo(() => groupDetail(tables, userId, route.params.groupId), [tables, userId, route.params.groupId]);
  const m = d?.members.find((x) => x.member_id === route.params.memberId);
  const [name, setName] = useState(m?.display_name ?? '');
  const [confirm, setConfirm] = useState<'remove' | 'owner' | null>(null);
  const [error, setError] = useState(false);

  if (!d || !m) {
    return (
      <Screen testID="screen-member-missing">
        <BackButton onPress={() => navigation.goBack()} />
        <Body muted>{strings['common.error']}</Body>
      </Screen>
    );
  }
  const can = memberActions(d, m);

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
        <View style={{ gap: 8 }}>
          <Field label={strings['member.name']} value={name} onChangeText={setName} testID="member-name" />
          <Button kind="secondary" label={strings['member.saveName']} disabled={name.trim() === '' || name.trim() === m.display_name} onPress={() => store.dispatch(renameMember(m.member_id, name.trim()))} />
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
      {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>{`${strings['common.error']} ${strings['common.offlineOnly']}`}</Text> : null}
      {confirm === 'owner' ? (
        <View style={{ gap: 8 }}>
          <Body>{strings['member.makeOwnerConfirm'](m.display_name)}</Body>
          <Button
            kind="danger"
            label={strings['member.makeOwnerYes']}
            testID="make-owner-confirm"
            onPress={async () => {
              setError(false);
              try {
                await account.transferOwnership(d.group.id, m.member_id);
                store.refresh();
                navigation.goBack();
              } catch {
                setError(true);
              }
            }}
          />
          <Button kind="secondary" label={strings['common.cancel']} onPress={() => setConfirm(null)} />
        </View>
      ) : can.makeOwner ? (
        <Button kind="secondary" label={strings['member.makeOwner']} onPress={() => setConfirm('owner')} testID="make-owner" />
      ) : null}
      {confirm === 'remove' ? (
        <View style={{ gap: 8 }}>
          <Body>{strings['member.removeConfirm'](m.display_name)}</Body>
          <Button
            kind="danger"
            label={strings['member.remove']}
            testID="remove-confirm"
            onPress={() => {
              store.dispatch(remove('group_members', m.member_id));
              navigation.goBack();
            }}
          />
          <Button kind="secondary" label={strings['common.cancel']} onPress={() => setConfirm(null)} />
        </View>
      ) : can.remove ? (
        <Button kind="danger" label={strings['member.remove']} onPress={() => setConfirm('remove')} testID="remove-member" />
      ) : null}
    </Screen>
  );
}
