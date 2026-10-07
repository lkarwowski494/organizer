/**
 * Grupa: członkowie z rolami, zaproszenie linkiem (D48: 7 dni, 10 osób), profil dziecka bez konta (D10),
 * zmiana nazwy, listy grupy, wyjście (owner nie wychodzi — strażnik członkostw).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { groupLines } from '../../config/theme';
import { addChild, remove, renameGroup, setGroupColor } from '../../domain/views/commands';
import { formatDue } from '../../domain/format';
import { groupDetail, listsView } from '../../domain/views';
import { groupSeries } from '../../domain/views/events';
import { strings } from '../../i18n/strings.pl';
import type { Invite } from '../../sync/account';
import { BackButton, Body, Button, Field, NavRow, Screen, SectionTitle, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<RootStackParams, 'Group'>;

export function GroupScreen({ route, navigation }: Props) {
  const { userId, store, account, newId } = useServices();
  const { tables, today } = useAppData();
  const { c, font, line } = useTheme();
  const d = useMemo(() => groupDetail(tables, userId, route.params.groupId), [tables, userId, route.params.groupId]);
  const lists = useMemo(() => listsView(tables, userId, route.params.groupId), [tables, userId, route.params.groupId]);
  const series = useMemo(() => groupSeries(tables, userId, route.params.groupId, today), [tables, userId, route.params.groupId, today]);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [child, setChild] = useState('');
  const [name, setName] = useState(d?.group.name ?? '');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
        <NavRow
          key={m.member_id}
          testID={`member-${m.member_id}`}
          title={m.display_name}
          subtitle={strings[`groups.role.${m.role}`]}
          onPress={() => navigation.navigate('Member', { groupId: d.group.id, memberId: m.member_id })}
        />
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
      {d.canSetColor ? (
        <View accessibilityRole="radiogroup" accessibilityLabel={strings['groups.color']} style={{ gap: 8 }}>
          <SectionTitle>{strings['groups.color']}</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {groupLines.map((g, i) => {
              const on = d.group.color === g.key;
              return (
                <Pressable
                  key={g.key}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={strings['groups.colorA11y'](g.key)}
                  onPress={() => store.dispatch(setGroupColor(d.group.id, g.key))}
                  style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: on ? 3 : 0, borderColor: c.ink }}
                >
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: line(i).line }} />
                </Pressable>
              );
            })}
          </View>
          <Button kind="secondary" label={strings['groups.colorAuto']} disabled={d.group.color === null} onPress={() => store.dispatch(setGroupColor(d.group.id, null))} />
        </View>
      ) : null}
      <SectionTitle>{strings['groups.lists']}</SectionTitle>
      {lists.map((l) => (
        <NavRow key={l.id} title={l.name} subtitle={strings['lists.open'](l.open)} line={l.line} onPress={() => navigation.navigate('List', { listId: l.id })} />
      ))}
      <Button kind="secondary" label={strings['lists.new']} onPress={() => navigation.navigate('NewList', { groupId: d.group.id })} />
      <SectionTitle>{strings['event.groupEvents']}</SectionTitle>
      {series.length === 0 ? <Body muted>{strings['event.noGroupEvents']}</Body> : null}
      {series.map((e) => (
        <NavRow
          key={e.id}
          testID={`series-${e.id}`}
          title={e.title}
          subtitle={[e.summary, e.time, e.next ? strings['event.next'](formatDue({ date: e.next, time: null }, today)) : strings['event.ended']].filter(Boolean).join(' · ')}
          line={d.group.line}
          onPress={() => navigation.navigate('Event', { eventId: e.id, date: e.next ?? e.start })}
        />
      ))}
      {d.group.me.role === 'child' ? null : <Button kind="secondary" label={strings['calendar.addEvent']} testID="group-add-event" onPress={() => navigation.navigate('EventEdit', { groupId: d.group.id })} />}
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
      {d.canDelete ? (
        confirmDelete ? (
          <View style={{ gap: 8 }}>
            <Body>{strings['groups.deleteConfirm'](config.sync.TOMBSTONE_DAYS)}</Body>
            <Button
              kind="danger"
              label={strings['groups.deleteYes']}
              testID="delete-group-confirm"
              onPress={async () => {
                setError(false);
                try {
                  await account.deleteGroup(d.group.id);
                  store.refresh();
                  navigation.goBack();
                } catch {
                  setError(true);
                }
              }}
            />
            <Button kind="secondary" label={strings['common.cancel']} onPress={() => setConfirmDelete(false)} />
          </View>
        ) : (
          <Button kind="danger" label={strings['groups.delete']} onPress={() => setConfirmDelete(true)} testID="delete-group" />
        )
      ) : null}
    </Screen>
  );
}
