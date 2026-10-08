/** Nowa grupa (RPC create_group — wymaga internetu): nazwa i moje imię w tej grupie. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text } from 'react-native';

import { useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { nextStepsKey, starterListsOps } from '../../domain/views/starter';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Button, Field, Screen, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { groupErrorText } from './server-errors';

type Props = NativeStackScreenProps<RootStackParams, 'NewGroup'>;

export function NewGroupScreen({ navigation, route }: Props) {
  const { account, newId, displayName, store, prefs } = useServices();
  const { c, font } = useTheme();
  const [name, setName] = useState(route.params?.name ?? '');
  const [me, setMe] = useState(displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Audyt 2 (R-27): te same identyfikatory przy ponowieniu — gdy odpowiedź serwera zginęła, druga próba nie tworzy
  // drugiej grupy, a serwer potwierdza istniejącą (create_group_with_owner, migracja 20261008360000).
  const [ids] = useState(() => ({ groupId: newId(), ownerMemberId: newId() }));

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await account.createGroup({ ...ids, name: name.trim(), displayName: me.trim() });
      // Decyzja właściciela z 8.10.2026 (PW-36 A): grupa z Pierwszych kroków dostaje od razu „Zakupy” i „Zadania”
      // (kolejka, jak każda nowa lista) i kartę „Następne kroki” na ekranie grupy (pamiętaną na tym telefonie).
      if (route.params?.starter) {
        store.dispatch(starterListsOps(ids.groupId, newId));
        prefs?.set(nextStepsKey(ids.groupId), '1').catch(() => {});
      }
      store.refresh();
      navigation.replace('Group', { groupId: ids.groupId, fresh: true });
    } catch (e) {
      setError(groupErrorText(e));
      setBusy(false);
    }
  };

  return (
    <Screen testID="screen-new-group">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings['groups.new']}</Title>
      <Field label={strings['groups.name']} value={name} onChangeText={setName} autoFocus testID="group-name" />
      <Field label={strings['groups.myName']} value={me} onChangeText={setMe} testID="group-my-name" />
      {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>{error}</Text> : null}
      <Button label={strings['groups.create']} onPress={create} disabled={busy || name.trim() === '' || me.trim() === ''} testID="create-group" />
    </Screen>
  );
}
