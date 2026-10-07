/** Moje grupy: osobista i wspólne, z kolorem linii; nowa grupa i dołączenie z linku. */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { groupsView, trashedGroups } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { Button, NavRow, Screen, SectionTitle, Title } from '../../ui/components';

export function GroupsScreen() {
  const { userId, account, store, nowMs } = useServices();
  const { tables } = useAppData();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const groups = useMemo(() => groupsView(tables, userId), [tables, userId]);
  const trash = useMemo(() => trashedGroups(tables, userId, nowMs()), [tables, userId, nowMs]);
  return (
    <Screen testID="screen-groups">
      <Title>{strings['groups.title']}</Title>
      <View style={{ gap: 10 }}>
        {groups.map((g) => (
          <NavRow
            key={g.id}
            testID={`group-${g.id}`}
            title={g.kind === 'personal' ? strings['groups.personal'] : g.name}
            subtitle={`${strings['groups.members'](g.memberCount)} · ${strings[`groups.role.${g.me.role}`]}`}
            line={g.line}
            onPress={() => nav.navigate('Group', { groupId: g.id })}
          />
        ))}
      </View>
      <Button label={strings['groups.new']} onPress={() => nav.navigate('NewGroup')} />
      <Button kind="secondary" label={strings['groups.join']} onPress={() => nav.navigate('Invite', {})} />
      <Button kind="secondary" label={strings['settings.open']} onPress={() => nav.navigate('Settings')} />
      {trash.length ? (
        <View style={{ gap: 8 }}>
          <SectionTitle>{strings['groups.trash']}</SectionTitle>
          {trash.map((g) => (
            <NavRow
              key={g.id}
              testID={`trash-${g.id}`}
              title={strings['groups.restore'](g.name)}
              subtitle={strings['groups.trashLeft'](g.daysLeft)}
              onPress={() => void account.restoreGroup(g.id).then(store.refresh, () => {})}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
