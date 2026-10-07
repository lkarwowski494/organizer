/**
 * Grupa: członkowie z rolami, zaproszenie linkiem (D48: 7 dni, 10 osób), profil dziecka bez konta (D10),
 * zmiana nazwy, listy grupy, wyjście (owner nie wychodzi — strażnik członkostw).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Share, Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { addChild, remove, renameGroup } from '../../domain/views/commands';
import { groupDetail, listsView } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import type { Invite } from '../../sync/account';
import { BackButton, Body, Button, Field, NavRow, Screen, SectionTitle, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<RootStackParams, 'Group'>;

export function GroupScreen({ route, navigation }: Props) {
  const { userId, store, account, newId } = useServices();
  const { tables } = useAppData();
  const { c, font, line } = useTheme();
  const d = useMemo(() => groupDetail(tables, userId, route.params.groupId), [tables, userId, route.params.groupId]);
  const lists = useMemo(() => listsView(tables, userId, route.params.groupId), [tables, userId, route.params.groupId]);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [child, setChild] = useState('');
  const [name, setName] = useState(d?.group.name ?? '');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState(false);

  if (!d) {
    return (
      <Screen testID="screen-group-missing">
        <BackButton onPress={() => navigation.goBack()} />
        <Body muted>{strings['common.error']}</Body>
      </Screen>
    );
  }
  const personal = d.group.kind === 'personal';
  const makeInvite = async (role: 'member' | 'admin') => {
    setError(false);
    try {
      setInvite(await account.createInvite(d.group.id, role));
    } catch {
      setError(true);
    }
  };

  return (
    <Screen testID="screen-group">
      <BackButton onPress={() => navigation.goBack()} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 6, borderColor: line(d.group.line).line, backgroundColor: c.surface }} />
        <Title>{personal ? strings['groups.personal'] : d.group.name}</Title>
      </View>
      <SectionTitle>{strings['groups.members'](d.members.length)}</SectionTitle>
      {d.members.map((m) => (
        <Text key={m.member_id} style={{ fontFamily: font.text400, fontSize: 17, color: c.ink }}>
          {m.display_name}
          <Text style={{ color: c.inkMuted }}>{`  ·  ${strings[`groups.role.${m.role}`]}`}</Text>
        </Text>
      ))}
      {d.canInvite ? (
        <View style={{ gap: 8 }}>
          <Button label={strings['groups.invite']} onPress={() => makeInvite('member')} testID="invite" />
          {d.canInviteAdmin ? <Button kind="secondary" label={strings['groups.inviteAdmin']} onPress={() => makeInvite('admin')} /> : null}
        </View>
      ) : null}
      {invite ? (
        <View testID="invite-ready" style={{ gap: 8, padding: 14, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
          <Text style={{ fontFamily: font.text700, fontSize: 17, color: c.ink }}>{strings['groups.inviteReady']}</Text>
          <Body muted>{strings['groups.inviteInfo'](config.invites.DEFAULT_TTL_HOURS / 24, invite.maxUses)}</Body>
          <Button label={strings['groups.share']} onPress={() => void Share.share({ message: invite.url })} />
          <Button
            kind="danger"
            label={strings['groups.revoke']}
            onPress={async () => {
              await account.revokeInvite(invite.inviteId).catch(() => setError(true));
              setInvite(null);
            }}
          />
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>{`${strings['common.error']} ${strings['common.offlineOnly']}`}</Text> : null}
      {d.canManageMembers ? (
        <View style={{ gap: 8 }}>
          <Field label={strings['groups.childName']} value={child} onChangeText={setChild} testID="child-name" />
          <Button
            kind="secondary"
            label={strings['groups.addChild']}
            disabled={child.trim() === ''}
            onPress={() => {
              store.dispatch(addChild({ memberId: newId(), groupId: d.group.id, name: child.trim() }));
              setChild('');
            }}
          />
        </View>
      ) : null}
      {d.canRename ? (
        <View style={{ gap: 8 }}>
          <Field label={strings['groups.name']} value={name} onChangeText={setName} testID="group-rename" />
          <Button kind="secondary" label={strings['groups.rename']} disabled={name.trim() === '' || name.trim() === d.group.name} onPress={() => store.dispatch(renameGroup(d.group.id, name.trim()))} />
        </View>
      ) : null}
      <SectionTitle>{strings['groups.lists']}</SectionTitle>
      {lists.map((l) => (
        <NavRow key={l.id} title={l.name} subtitle={strings['lists.open'](l.open)} line={l.line} onPress={() => navigation.navigate('List', { listId: l.id })} />
      ))}
      <Button kind="secondary" label={strings['lists.new']} onPress={() => navigation.navigate('NewList', { groupId: d.group.id })} />
      {d.canLeave ? (
        confirmLeave ? (
          <View style={{ gap: 8 }}>
            <Body>{strings['groups.leaveConfirm']}</Body>
            <Button
              kind="danger"
              label={strings['groups.leave']}
              testID="leave-confirm"
              onPress={() => {
                store.dispatch(remove('group_members', d.group.me.member_id));
                navigation.goBack();
              }}
            />
            <Button kind="secondary" label={strings['common.cancel']} onPress={() => setConfirmLeave(false)} />
          </View>
        ) : (
          <Button kind="danger" label={strings['groups.leave']} onPress={() => setConfirmLeave(true)} testID="leave" />
        )
      ) : !personal ? (
        <Body muted>{strings['groups.ownerCannotLeave']}</Body>
      ) : null}
    </Screen>
  );
}
