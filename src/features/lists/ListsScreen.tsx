/** Wszystkie listy z moich grup, pogrupowane kolorem linii. */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { listsView } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, NavRow, Screen, Title } from '../../ui/components';

export function ListsScreen() {
  const { userId } = useServices();
  const { tables } = useAppData();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const lists = useMemo(() => listsView(tables, userId), [tables, userId]);
  return (
    <Screen testID="screen-lists">
      <Title>{strings['lists.title']}</Title>
      {lists.length === 0 ? <Body muted>{strings['lists.empty']}</Body> : null}
      <View style={{ gap: 10 }}>
        {lists.map((l) => (
          <NavRow
            key={l.id}
            testID={`list-${l.id}`}
            title={l.name}
            subtitle={`${l.groupName} · ${l.kind === 'shopping' ? strings['lists.kind.shopping'] : strings['lists.kind.tasks']} · ${strings['lists.open'](l.open)}`}
            line={l.line}
            onPress={() => nav.navigate('List', { listId: l.id })}
          />
        ))}
      </View>
      <Button label={strings['lists.new']} onPress={() => nav.navigate('NewList', { kind: 'tasks' })} />
      <Button kind="secondary" label={strings['lists.newShopping']} onPress={() => nav.navigate('NewList', { kind: 'shopping' })} />
    </Screen>
  );
}
