/**
 * Moje grupy: osobista i wspólne, z kolorem linii; nowa grupa i dołączenie z linku; „Ostatnie zmiany” (D194) i kosz
 * (grupy — D54; listy, zadania, wydarzenia i osoby — D151).
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { groupDetail, type GroupItem, groupsView } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { Button, ErrorText, NavRow, Screen, SwipeRow, Title } from '../../ui/components';
import { TabHeader, usePullRefresh } from '../../app/TabHeader';
import { useDeleteGroup } from './delete-group';
import { TrashSection } from './TrashSection';

export function GroupsScreen() {
  const { userId } = useServices();
  const { tables } = useAppData();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const groups = useMemo(() => groupsView(tables, userId), [tables, userId]);
  const refresh = usePullRefresh();
  const [error, setError] = useState<string | null>(null);

  // D187 i Q19 A (audyt 3, N-156): jak przycisk na ekranie grupy (delete-group.ts).
  const removeGroup = useDeleteGroup(setError);
  const deleteGroup = (g: GroupItem) => {
    setError(null);
    removeGroup(g.id, g.name, g.memberCount - 1);
  };

  return (
    <Screen testID="screen-groups" refresh={refresh}>
      <TabHeader />
      <Title>{strings['tabs.groups']}</Title>
      <View style={{ gap: 10 }}>
        {groups.map((g) => (
          <SwipeRow key={g.id} title={g.name} enabled={groupDetail(tables, userId, g.id)?.canDelete === true} onDelete={() => deleteGroup(g)} testID={`swipe-${g.id}`}>
            <NavRow
              testID={`group-${g.id}`}
              title={g.kind === 'personal' ? strings['groups.personal'] : g.name}
              subtitle={g.kind === 'personal' ? strings['groups.personalSubtitle'] : `${strings['groups.members'](g.memberCount)} · ${strings[`groups.role.${g.me.role}`]}`}
              line={g.line}
              onPress={() => nav.navigate('Group', { groupId: g.id })}
            />
          </SwipeRow>
        ))}
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label={strings['groups.new']} onPress={() => nav.navigate('NewGroup')} />
      <Button kind="secondary" label={strings['groups.join']} onPress={() => nav.navigate('Invite', {})} />
      <NavRow title={strings['recent.title']} testID="open-recent" onPress={() => nav.navigate('Recent')} />
      <TrashSection />
    </Screen>
  );
}
