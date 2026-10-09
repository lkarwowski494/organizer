/**
 * Grupa: członkowie z rolami, zaproszenie ID grupy + kodem 24 h (D92–D94), profil dziecka bez konta (D10),
 * zmiana nazwy, listy grupy, wyjście (owner nie wychodzi — strażnik członkostw).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, type TextInput, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { groupLines } from '../../config/theme';
import { addChild, remove, renameGroup, restore, setGroupColor } from '../../domain/views/commands';
import { formatDue } from '../../domain/format';
import { groupDetail, listOpenCount, listsView, type Member, memberActions } from '../../domain/views';
import { groupSeries } from '../../domain/views/events';
import { nextStepsKey } from '../../domain/views/starter';
import { strings } from '../../i18n/strings.pl';
import type { JoinInvite } from '../../sync/account';
import { buttonA11y } from '../../ui/a11y';
import { BackButton, Body, Button, Card, CardTitle, ErrorText, Field, GroupMark, NavRow, Screen, SectionTitle, Segmented, SwipeRow, Title } from '../../ui/components';
import { useMyScope } from '../../app/my-scope';
import { MY_SCOPES } from '../../domain/views/my-scope';
import { useUndo } from '../../ui/undo';
import { useEventActions } from '../../app/event-actions';
import { useTaskActions } from '../../app/task-actions';
import { listMarks } from '../lists/ListsScreen';
import { useTheme } from '../../ui/theme';
import { useLiveText } from '../../ui/live-text';
import { useDeleteGroup } from './delete-group';
import { JoinCodeCard } from './JoinCodeCard';
import { groupErrorText } from './server-errors';

type Props = NativeStackScreenProps<RootStackParams, 'Group'>;

export function GroupScreen({ route, navigation }: Props) {
  const { userId, store, account, newId, prefs } = useServices();
  const { tables, today } = useAppData();
  const { c, line } = useTheme();
  const d = useMemo(() => groupDetail(tables, userId, route.params.groupId), [tables, userId, route.params.groupId]);
  const undo = useUndo();
  const actions = useTaskActions();
  const events = useEventActions();
  const lists = useMemo(() => listsView(tables, userId, route.params.groupId), [tables, userId, route.params.groupId]);
  const series = useMemo(() => groupSeries(tables, userId, route.params.groupId, today, strings['event.rule']), [tables, userId, route.params.groupId, today]);
  const [invite, setInvite] = useState<(JoinInvite & { role: 'member' | 'admin' }) | null>(null);
  const [child, setChild] = useState('');
  // D130 + audyt 2 (R-16, R-36, T-22): nazwa podąża za danymi (także po pobraniu i zmianie z drugiego telefonu),
  // dopóki jej nie edytuję; zapisuje się po wyjściu z pola albo z ekranu i tylko wtedy, gdy ją zmieniłem. Pustej nie
  // zapisujemy — komunikat (PW-20 A). Mechanizm wspólny z tytułem zadania (ui/live-text).
  const name = useLiveText(d?.group.name ?? '', (n) => d?.canRename && store.dispatch(renameGroup(d.group.id, n)), { empty: strings['groups.error.nameEmpty'] });
  const [error, setError] = useState<string | null>(null);
  const [childError, setChildError] = useState<string | null>(null);
  const myScope = useMyScope();
  // Karta „Następne kroki” nowej grupy (PW-36 A; od audytu 2 M-117 — każdej nowej, także z ekranu Grupy), do „Nie teraz”
  // na tym telefonie.
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
  const deleteGroup = useDeleteGroup(setError);

  if (!d) {
    // Grupa właśnie utworzona albo dołączona (parametr trasy) dochodzi z pierwszym pobraniem — bez komunikatu o błędzie.
    const loading = route.params.fresh === true && !tables.groups?.[route.params.groupId];
    return (
      <Screen testID={loading ? 'screen-group-loading' : 'screen-group-missing'}>
        <BackButton onPress={() => navigation.goBack()} />
        <Body muted>{loading ? strings['groups.loading'] : strings['missing.group']}</Body>
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
  const addChildNow = () => {
    if (child.trim() === '') return setChildError(strings['groups.error.childEmpty']);
    store.dispatch(addChild({ memberId: newId(), groupId: d.group.id, name: child.trim() }));
    setChild('');
  };
  const adminFirst = d.canInviteAdmin && d.members.some((m) => m.role === 'child');
  const shopping = lists.find((l) => l.kind === 'shopping');
  const inviteButtons = [
    <Button key="member" kind={adminFirst ? 'secondary' : 'primary'} label={strings['groups.invite']} onPress={() => void makeInvite('member')} testID="invite" />,
    ...(d.canInviteAdmin ? [<Button key="admin" kind={adminFirst ? 'primary' : 'secondary'} label={strings['groups.inviteAdmin']} onPress={() => void makeInvite('admin')} testID="invite-admin" />] : []),
  ];
  // Jak na ekranie osoby (PW-35 A, D165): bez pytania, z „Cofnij”; owner/admin przywraca też z kosza.
  const removeMember = (m: Member) => {
    const op = remove('group_members', m.member_id);
    store.dispatch(op);
    undo.show(strings['undo.memberRemoved'](m.display_name), { ops: [restore('group_members', m.member_id)] }, { changed: [op] });
  };

  return (
    <Screen testID="screen-group">
      <BackButton onPress={() => navigation.goBack()} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <GroupMark line={d.group.line} size={22} />
        <Title>{personal ? strings['groups.personal'] : d.group.name}</Title>
      </View>
      {nextSteps && d.canInvite ? (
        <Card testID="next-steps">
          <CardTitle>
            {strings['groups.nextSteps']}
          </CardTitle>
          <Body muted>{strings['groups.nextSteps.body']}</Body>
          {/* Audyt 3 (N-8, Q10 C): rola wybrana na karcie, nie przez kolejność kroków (wcześniej członek, gdy nie było
              jeszcze dzieci). Administratora zaprasza tylko właściciel — administrator widzi jeden przycisk „członek”. */}
          {d.canInviteAdmin ? (
            <>
              <Button label={strings['groups.nextSteps.invitePartner']} testID="next-invite-admin" onPress={() => void makeInvite('admin')} />
              <Button kind="secondary" label={strings['groups.nextSteps.inviteOther']} testID="next-invite" onPress={() => void makeInvite('member')} />
            </>
          ) : (
            <Button label={strings['groups.nextSteps.invite']} testID="next-invite" onPress={() => void makeInvite('member')} />
          )}
          {d.canManageMembers ? <Button kind="secondary" label={strings['groups.nextSteps.child']} testID="next-child" onPress={() => childField.current?.focus()} /> : null}
          {shopping ? (
            <Button kind="secondary" label={strings['trip.plan']} testID="next-shopping" onPress={() => navigation.navigate('List', { listId: shopping.id })} />
          ) : (
            <Button kind="secondary" label={strings['groups.nextSteps.newShopping']} testID="next-new-shopping" onPress={() => navigation.navigate('NewList', { groupId: d.group.id, kind: 'shopping' })} />
          )}
          <Button
            kind="secondary"
            label={strings['common.later']}
            testID="next-later"
            onPress={() => {
              setNextSteps(false);
              prefs?.set(nextStepsKey(d.group.id), '0').catch(() => {});
            }}
          />
        </Card>
      ) : null}
      {/* Audyt 3 (N-161): dziecko z kontem widzi w Moich sprawach tylko swoje sprawy (PW-14 B, child.ts) — zakres nic by
          nie zmienił, więc go nie ma. */}
      {personal || d.group.me.role === 'child' ? null : (
        <View style={{ gap: 6 }}>
          {/* PW-2 A (M-35): podpowiedź po dołączeniu do dużej grupy, dopóki zakres to „Wszystko”. */}
          {route.params.fresh && d.members.length >= config.myDays.LARGE_GROUP_MEMBERS && myScope.scopeOf(d.group.id) === 'all' ? (
            <Body testID="my-scope-hint">{strings['myScope.hint'](d.members.length)}</Body>
          ) : null}
          <Segmented
            label={strings['myScope.title']}
            value={myScope.scopeOf(d.group.id)}
            options={MY_SCOPES.map((v) => ({ value: v, label: strings[`myScope.${v}`] }))}
            onChange={(v) => myScope.set(d.group.id, v)}
          />
          <Body muted>{strings['myScope.info']}</Body>
        </View>
      )}
      <SectionTitle>{strings['groups.members'](d.members.length)}</SectionTitle>
      {/* Audyt 2 (M-239): osoby, listy i wydarzenia usuwa się przesunięciem jak zadania — z prawami jak na ich ekranach. */}
      {d.members.map((m) => (
        <SwipeRow key={m.member_id} title={m.display_name} enabled={memberActions(d, m).remove} onDelete={() => removeMember(m)} testID={`swipe-${m.member_id}`}>
          <NavRow
            testID={`member-${m.member_id}`}
            title={m.user_id === userId ? strings['who.meSuffix'](m.display_name) : m.display_name}
            subtitle={strings[`groups.role.${m.role}`]}
            onPress={() => navigation.navigate('Member', { groupId: d.group.id, memberId: m.member_id })}
          />
        </SwipeRow>
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
        // Audyt 2 (M-241): unieważnia wysłane kody — czerwony w obu krokach (przycisk i potwierdzenie).
        <Button
          kind="danger"
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
      {error ? <ErrorText>{error}</ErrorText> : null}
      {d.canManageMembers ? (
        <View style={{ gap: 8 }}>
          {/* PWD-5 A (M-274): przycisk zawsze aktywny, komunikat przy polu; M-243: Return dodaje. */}
          <Field ref={childField} label={strings['groups.childName']} value={child} onChangeText={(v) => (setChild(v), setChildError(null))} onSubmitEditing={addChildNow} returnKeyType="done" maxLength={config.profile.NAME_MAX_LENGTH} testID="child-name" />
          {childError ? <ErrorText testID="child-error">{childError}</ErrorText> : null}
          <Button kind="secondary" label={strings['groups.addChild']} testID="add-child" onPress={addChildNow} />
        </View>
      ) : null}
      {d.canRename ? (
        <View style={{ gap: 6 }}>
          <Field label={strings['groups.name']} {...name.field} maxLength={config.lengths.GROUP_NAME} returnKeyType="done" testID="group-rename" />
          {name.error ? <ErrorText>{name.error}</ErrorText> : null}
        </View>
      ) : null}
      {d.canSetColor ? (
        <View style={{ gap: 8 }}>
          <SectionTitle>{strings['groups.color']}</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {groupLines.map((g, i) => {
              const on = d.group.color === g.key;
              return (
                <Pressable
                  key={g.key}
                  {...buttonA11y({ selected: on })}
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
      {lists.length === 0 ? <Body muted>{strings['groups.noLists']}</Body> : null}
      {lists.map((l) => (
        <SwipeRow key={l.id} title={l.name} enabled={d.group.me.role !== 'child'} onDelete={() => actions.removeList(l)} testID={`swipe-${l.id}`}>
          <NavRow testID={`group-list-${l.id}`} title={l.name} subtitle={listMarks(l, listOpenCount(tables, l, today)).join(' · ')} line={l.line} onPress={() => navigation.navigate('List', { listId: l.id })} />
        </SwipeRow>
      ))}
      {d.group.me.role === 'child' ? null : <Button kind="secondary" label={strings['lists.new']} onPress={() => navigation.navigate('NewList', { groupId: d.group.id })} />}
      <SectionTitle>{strings['event.groupEvents']}</SectionTitle>
      {series.length === 0 ? <Body muted>{strings['event.noGroupEvents']}</Body> : null}
      {series.map((e) => (
        <SwipeRow key={e.id} title={e.title} enabled={d.group.me.role !== 'child'} onDelete={() => events.cancel(e.id, e.nextOccurrence ?? e.start, true)} testID={`swipe-${e.id}`}>
          <NavRow
            testID={`series-${e.id}`}
            title={e.title}
            subtitle={[e.summary, e.time, e.next ? strings['event.next'](formatDue({ date: e.next, time: null }, today)) : strings['event.ended']].filter(Boolean).join(' · ')}
            line={d.group.line}
            // Audyt 2 (E-19): napis z dniem po przeniesieniu, a otwarcie po dacie wystąpienia według reguły.
            onPress={() => navigation.navigate('Event', { eventId: e.id, date: e.nextOccurrence ?? e.start })}
          />
        </SwipeRow>
      ))}
      {d.group.me.role === 'child' ? null : <Button kind="secondary" label={strings['calendar.addEvent']} testID="group-add-event" onPress={() => navigation.navigate('EventEdit', { groupId: d.group.id })} />}
      {/* Audyt 2 (PWD-26): rutyna i plan lekcji dziecka (D128) także z ekranu grupy, nie tylko z Kalendarza i ekranu osoby. */}
      {d.group.me.role === 'child' ? null : <Button kind="secondary" label={strings['routine.add']} testID="group-add-routine" onPress={() => navigation.navigate('Routine', { groupId: d.group.id })} />}
      {d.group.kind === 'shared' && d.group.me.role !== 'child'
        ? d.members
            .filter((m) => m.role === 'child')
            .map((m) => <Button key={m.member_id} kind="secondary" label={strings['timetable.title'](m.display_name)} testID={`group-timetable-${m.member_id}`} onPress={() => navigation.navigate('Timetable', { groupId: d.group.id, memberId: m.member_id })} />)
        : null}
      {/* PWD-4 A (M-273): proste tak/nie — okno systemowe (wybór z kilku opcji zostaje panelem w ekranie). */}
      {d.canLeave ? (
        <Button
          kind="danger"
          label={strings['groups.leave']}
          testID="leave"
          onPress={() =>
            Alert.alert(strings['groups.leave'], strings['groups.leaveConfirm'](config.sync.TOMBSTONE_DAYS), [
              { text: strings['common.cancel'], style: 'cancel' },
              {
                text: strings['groups.leave'],
                style: 'destructive',
                onPress: () => {
                  dropNameEdit();
                  store.dispatch(remove('group_members', d.group.me.member_id));
                  navigation.goBack();
                },
              },
            ])
          }
        />
      ) : !personal ? (
        <Body muted>{strings[d.group.me.role === 'child' ? 'groups.childCannotLeave' : 'groups.ownerCannotLeave']}</Body>
      ) : null}
      {/* D187 i Q19 A (audyt 3, N-156): do kosza z „Cofnij”; pytanie tylko, gdy w grupie są inni (delete-group.ts). */}
      {d.canDelete ? (
        <Button
          kind="danger"
          label={strings['groups.delete']}
          testID="delete-group"
          onPress={() => {
            setError(null);
            deleteGroup(d.group.id, d.group.name, d.members.length - 1, { before: dropNameEdit, after: () => navigation.goBack() });
          }}
        />
      ) : null}
    </Screen>
  );
}
