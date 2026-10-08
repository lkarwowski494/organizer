/** Wszystkie listy z moich grup, pogrupowane kolorem linii. */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { type List, listOpenCount, listsView } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, NavRow, Screen, Title } from '../../ui/components';

/** Licznik listy (audyt 2, M-83, U-61): „N otwarte”, a przy zakupach „N do kupienia” — jak w Moich sprawach. */
export const openLabel = (kind: List['kind'], n: number) => (kind === 'shopping' ? strings['trip.open'](n) : strings['lists.open'](n));

/**
 * Opis listy w wierszu i nagłówku: „Tylko ja” przy liście prywatnej (decyzja właściciela z 8.10.2026, PW-17 B, M-107)
 * i licznik (M-83). Listę prywatną widzi tylko jej właściciel, więc oznaczenie widzi tylko on.
 */
export const listMarks = (l: Pick<List, 'kind' | 'visibility'>, n: number) => [...(l.visibility === 'private' ? [strings['lists.visibility.private']] : []), openLabel(l.kind, n)];

export function ListsScreen() {
  const { userId } = useServices();
  const { tables, today } = useAppData();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const lists = useMemo(() => listsView(tables, userId).map((l) => ({ ...l, open: listOpenCount(tables, l, today) })), [tables, userId, today]);
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
            subtitle={[l.groupName, l.kind === 'shopping' ? strings['lists.kind.shopping'] : strings['lists.kind.tasks'], ...listMarks(l, l.open)].join(' · ')}
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
