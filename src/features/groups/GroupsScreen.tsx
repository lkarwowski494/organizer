/**
 * Moje grupy: osobista i wspólne, z kolorem linii; nowa grupa i dołączenie z linku; „Ostatnie zmiany” (D194) i kosz
 * (grupy — D54; listy, zadania, wydarzenia i osoby — D151).
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { groupDetail, type GroupItem, groupsView } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { Button, NavRow, Screen, SwipeRow, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { useUndo } from '../../ui/undo';
import { groupErrorText } from './server-errors';
import { TrashSection } from './TrashSection';

export function GroupsScreen() {
  const { userId, account, store } = useServices();
  const { tables } = useAppData();
  const { c, font } = useTheme();
  const undo = useUndo();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const groups = useMemo(() => groupsView(tables, userId), [tables, userId]);
  const [error, setError] = useState<string | null>(null);

  // D187 (audyt 2: PW-16 A, M-121, M-239): grupa do kosza bez pytania — pasek „Cofnij” i kosz (właściciel, 30 dni).
  // Usunięcie i przywrócenie idą przez serwer, więc wymagają internetu (komunikat błędu jak na ekranie grupy).
  const deleteGroup = (g: GroupItem) => {
    setError(null);
    account.deleteGroup(g.id).then(
      () => {
        store.refresh();
        undo.show(strings['undo.groupDeleted'](g.name), () => {
          account.restoreGroup(g.id).then(
            () => store.refresh(),
            (e: unknown) => setError(groupErrorText(e)),
          );
        });
      },
      (e: unknown) => setError(groupErrorText(e)),
    );
  };

  return (
    <Screen testID="screen-groups">
      <Title>{strings['groups.title']}</Title>
      <View style={{ gap: 10 }}>
        {groups.map((g) => (
          <SwipeRow key={g.id} title={g.name} enabled={groupDetail(tables, userId, g.id)?.canDelete === true} onDelete={() => deleteGroup(g)} testID={`swipe-${g.id}`}>
            <NavRow
              testID={`group-${g.id}`}
              title={g.kind === 'personal' ? strings['groups.personal'] : g.name}
              subtitle={`${strings['groups.members'](g.memberCount)} · ${strings[`groups.role.${g.me.role}`]}`}
              line={g.line}
              onPress={() => nav.navigate('Group', { groupId: g.id })}
            />
          </SwipeRow>
        ))}
      </View>
      {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>{error}</Text> : null}
      <Button label={strings['groups.new']} onPress={() => nav.navigate('NewGroup')} />
      <Button kind="secondary" label={strings['groups.join']} onPress={() => nav.navigate('Invite', {})} />
      <Button kind="secondary" label={strings['settings.open']} onPress={() => nav.navigate('Settings')} />
      <NavRow title={strings['recent.title']} testID="open-recent" onPress={() => nav.navigate('Recent')} />
      <TrashSection />
    </Screen>
  );
}
