/**
 * Grupa: członkowie z rolami, zaproszenie ID grupy + kodem 24 h (D92–D94), profil dziecka bez konta (D10),
 * zmiana nazwy, listy grupy, wyjście (owner nie wychodzi — strażnik członkostw).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, type TextInput, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { groupLines } from '../../config/theme';
import { addChild, remove, renameGroup, setGroupColor } from '../../domain/views/commands';
import { formatDue } from '../../domain/format';
import { groupDetail, listOpenCount, listsView } from '../../domain/views';
import { groupSeries } from '../../domain/views/events';
import { nextStepsKey } from '../../domain/views/starter';
import { strings } from '../../i18n/strings.pl';
import type { JoinInvite } from '../../sync/account';
import { BackButton, Body, Button, ErrorText, Field, NavRow, Screen, SectionTitle, Title } from '../../ui/components';
import { listMarks } from '../lists/ListsScreen';
import { useTheme } from '../../ui/theme';
import { useLiveText } from '../../ui/live-text';
import { JoinCodeCard } from './JoinCodeCard';
import { groupErrorText } from './server-errors';

type Props = NativeStackScreenProps<RootStackParams, 'Group'>;

export function GroupScreen({ route, navigation }: Props) {
  const { userId, store, account, newId, prefs } = useServices();
  const { tables, today } = useAppData();
  const { c, font, line } = useTheme();
  const d = useMemo(() => groupDetail(tables, userId, route.params.groupId), [tables, userId, route.params.groupId]);
  const lists = useMemo(() => listsView(tables, userId, route.params.groupId), [tables, userId, route.params.groupId]);
  const series = useMemo(() => groupSeries(tables, userId, route.params.groupId, today), [tables, userId, route.params.groupId, today]);
  const [invite, setInvite] = useState<(JoinInvite & { role: 'member' | 'admin' }) | null>(null);
  const [child, setChild] = useState('');
  // D130 + audyt 2 (R-16, R-36, T-22): nazwa podąża za danymi (także po pobraniu i zmianie z drugiego telefonu),
  // dopóki jej nie edytuję; zapisuje się po wyjściu z pola albo z ekranu i tylko wtedy, gdy ją zmieniłem. Pustej nie
  // zapisujemy — komunikat (PW-20 A). Mechanizm wspólny z tytułem zadania (ui/live-text).
  const name = useLiveText(d?.group.name ?? '', (n) => d?.canRename && store.dispatch(renameGroup(d.group.id, n)), { empty: strings['groups.error.nameEmpty'] });
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Karta „Następne kroki” grupy z Pierwszych kroków (PW-36 A), do „Nie teraz” na tym telefonie.
  const [nextSteps, setNextSteps] = useState(false);
  const childField = useRef<TextInput>(null);
  useEffect(() => {
    let live = true;
    prefs
      ?.get(nextStepsKey(route.params.groupId))
      .then((v) => live && setNextSteps(v === '1'))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [prefs, route.params.groupId]);
  // Przy wyjściu z grupy i przy koszu niezapisana nazwa przepada (serwer odrzuciłby zmianę w grupie, której już nie ma).
  const dropNameEdit = name.drop;

  if (!d) {
    // Grupa właśnie utworzona albo dołączona (parametr trasy) dochodzi z pierwszym pobraniem — bez komunikatu o błędzie.
    const loading = route.params.fresh === true && !tables.groups?.[route.params.groupId];
    return (
      <Screen testID={loading ? 'screen-group-loading' : 'screen-group-missing'}>
        <BackButton onPress={() => navigation.goBack()} />
        <Body muted>{loading ? strings['groups.loading'] : strings['common.error']}</Body>
      </Screen>
    );
  }
  const personal = d.group.kind === 'personal';
  // Decyzja właściciela z 8.10.2026 (PW-41 A): „Zaproś” pokazuje bieżący ważny kod tej roli (serwer tworzy nowy, gdy
  // ważnego nie ma), „Nowy kod” tworzy kolejny i unieważnia poprzedni.
  const makeInvite = async (role: 'member' | 'admin', renew = false) => {
    setError(null);
    try {
      setInvite({ ...(await (renew ? account.renewJoinCode(d.group.id, role) : account.createJoinCode(d.group.id, role))), role });
    } catch (e) {
      setError(groupErrorText(e));
    }
  };
  // Decyzja właściciela z 8.10.2026 (PW-34 A): w grupie z dziećmi domyślnie (pierwszy, główny przycisk) zaproszenie admina —
  // drugi rodzic jako członek nie doda dziecka ani nie zaprosi babci. Admina zaprasza tylko owner (canInviteAdmin).
  const adminFirst = d.canInviteAdmin && d.members.some((m) => m.role === 'child');
  const shopping = lists.find((l) => l.kind === 'shopping');
  const inviteButtons = [
    <Button key="member" kind={adminFirst ? 'secondary' : 'primary'} label={strings['groups.invite']} onPress={() => void makeInvite('member')} testID="invite" />,
    ...(d.canInviteAdmin ? [<Button key="admin" kind={adminFirst ? 'primary' : 'secondary'} label={strings['groups.inviteAdmin']} onPress={() => void makeInvite('admin')} testID="invite-admin" />] : []),
  ];
  return (
    <Screen testID="screen-group">
      <BackButton onPress={() => navigation.goBack()} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 6, borderColor: line(d.group.line).line, backgroundColor: c.surface }} />
        <Title>{personal ? strings['groups.personal'] : d.group.name}</Title>
      </View>
      {nextSteps && d.canInvite ? (
        <View testID="next-steps" style={{ gap: 8, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
          <Text accessibilityRole="header" style={{ fontFamily: font.text700, fontSize: 17, color: c.ink }}>
            {strings['groups.nextSteps']}
          </Text>
          <Body muted>{strings['groups.nextSteps.body']}</Body>
          <Button label={strings['groups.nextSteps.invite']} testID="next-invite" onPress={() => void makeInvite(adminFirst ? 'admin' : 'member')} />
          {d.canManageMembers ? <Button kind="secondary" label={strings['groups.nextSteps.child']} testID="next-child" onPress={() => childField.current?.focus()} /> : null}
          {shopping ? <Button kind="secondary" label={strings['groups.nextSteps.shopping']} testID="next-shopping" onPress={() => navigation.navigate('List', { listId: shopping.id })} /> : null}
          <Button
            kind="secondary"
            label={strings['groups.nextSteps.later']}
            testID="next-later"
            onPress={() => {
              setNextSteps(false);
              prefs?.set(nextStepsKey(d.group.id), '0').catch(() => {});
            }}
          />
        </View>
      ) : null}
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
          {adminFirst ? inviteButtons.reverse() : inviteButtons}
          <Body muted>{strings['groups.rolesInfo']}</Body>
        </View>
      ) : null}
      {invite ? (
        <JoinCodeCard
          code={invite}
          today={today}
          title={strings['groups.inviteReady']}
          note={strings['groups.inviteAs'](strings[`groups.role.${invite.role}`])}
          info={(u) => strings['groups.joinInfo'](u, config.invites.MAX_USES_LIMIT, config.invites.LINK_LIVE)}
          message={(id, code, u) => strings['groups.joinMessage'](d.group.name, config.invites.LINK_LIVE ? invite.url : null, id, code, u, config.invites.TESTFLIGHT_LINK)}
          onRenew={() => void makeInvite(invite.role, true)}
          onRevoke={async () => {
            setError(null);
            try {
              await account.revokeInvite(invite.inviteId);
              setInvite(null);
            } catch (e) {
              setError(groupErrorText(e));
            }
          }}
          testIDs={{ card: 'invite-ready', code: 'join-code', renew: 'invite-new-code' }}
        />
      ) : null}
      {d.group.me.role === 'owner' && !personal ? (
        <Button
          kind="secondary"
          label={strings['groups.rotate']}
          testID="rotate-join-id"
          onPress={() =>
            Alert.alert(strings['groups.rotate'], strings['groups.rotateConfirm'], [
              { text: strings['common.cancel'], style: 'cancel' },
              {
                text: strings['groups.rotate'],
                style: 'destructive',
                onPress: () => {
                  setInvite(null);
                  account.rotateJoinId(d.group.id).then(
                    () => store.refresh(),
                    (e: unknown) => setError(groupErrorText(e)),
                  );
                },
              },
            ])
          }
        />
      ) : null}
      {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>{error}</Text> : null}
      {d.canManageMembers ? (
        <View style={{ gap: 8 }}>
          <Field ref={childField} label={strings['groups.childName']} value={child} onChangeText={setChild} maxLength={config.profile.NAME_MAX_LENGTH} testID="child-name" />
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
        <View style={{ gap: 6 }}>
          <Field label={strings['groups.name']} {...name.field} maxLength={config.lengths.GROUP_NAME} testID="group-rename" />
          {name.error ? <ErrorText>{name.error}</ErrorText> : null}
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
        <NavRow key={l.id} title={l.name} subtitle={listMarks(l, listOpenCount(tables, l, today)).join(' · ')} line={l.line} onPress={() => navigation.navigate('List', { listId: l.id })} />
      ))}
      {d.group.me.role === 'child' ? null : <Button kind="secondary" label={strings['lists.new']} onPress={() => navigation.navigate('NewList', { groupId: d.group.id })} />}
      <SectionTitle>{strings['event.groupEvents']}</SectionTitle>
      {series.length === 0 ? <Body muted>{strings['event.noGroupEvents']}</Body> : null}
      {series.map((e) => (
        <NavRow
          key={e.id}
          testID={`series-${e.id}`}
          title={e.title}
          subtitle={[e.summary, e.time, e.next ? strings['event.next'](formatDue({ date: e.next, time: null }, today)) : strings['event.ended']].filter(Boolean).join(' · ')}
          line={d.group.line}
          // Audyt 2 (E-19): napis z dniem po przeniesieniu, a otwarcie po dacie wystąpienia według reguły.
          onPress={() => navigation.navigate('Event', { eventId: e.id, date: e.nextOccurrence ?? e.start })}
        />
      ))}
      {d.group.me.role === 'child' ? null : <Button kind="secondary" label={strings['calendar.addEvent']} testID="group-add-event" onPress={() => navigation.navigate('EventEdit', { groupId: d.group.id })} />}
      {/* Audyt 2 (PWD-26): rutyna i plan lekcji dziecka (D128) także z ekranu grupy, nie tylko z Kalendarza i ekranu osoby. */}
      {d.group.me.role === 'child' ? null : <Button kind="secondary" label={strings['routine.add']} testID="group-add-routine" onPress={() => navigation.navigate('Routine', { groupId: d.group.id })} />}
      {d.group.kind === 'shared' && d.group.me.role !== 'child'
        ? d.members
            .filter((m) => m.role === 'child')
            .map((m) => <Button key={m.member_id} kind="secondary" label={strings['timetable.title'](m.display_name)} testID={`group-timetable-${m.member_id}`} onPress={() => navigation.navigate('Timetable', { groupId: d.group.id, memberId: m.member_id })} />)
        : null}
      {d.canLeave ? (
        confirmLeave ? (
          <View style={{ gap: 8 }}>
            <Body>{strings['groups.leaveConfirm'](config.sync.TOMBSTONE_DAYS)}</Body>
            <Button
              kind="danger"
              label={strings['groups.leave']}
              testID="leave-confirm"
              onPress={() => {
                dropNameEdit();
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
        <Body muted>{strings[d.group.me.role === 'child' ? 'groups.childCannotLeave' : 'groups.ownerCannotLeave']}</Body>
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
                setError(null);
                try {
                  await account.deleteGroup(d.group.id);
                  dropNameEdit();
                  store.refresh();
                  navigation.goBack();
                } catch (e) {
                  setError(groupErrorText(e));
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
