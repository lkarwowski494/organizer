/** Nowa grupa (RPC create_group — wymaga internetu): nazwa i moje imię w tej grupie. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text } from 'react-native';

import { useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Button, Field, Screen, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<RootStackParams, 'NewGroup'>;

export function NewGroupScreen({ navigation, route }: Props) {
  const { account, newId, displayName, store } = useServices();
  const { c, font } = useTheme();
  const [name, setName] = useState(route.params?.name ?? '');
  const [me, setMe] = useState(displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(false);
    const groupId = newId();
    try {
      await account.createGroup({ groupId, name: name.trim(), ownerMemberId: newId(), displayName: me.trim() });
      store.refresh();
      navigation.replace('Group', { groupId });
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <Screen testID="screen-new-group">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings['groups.new']}</Title>
      <Field label={strings['groups.name']} value={name} onChangeText={setName} autoFocus maxLength={config.lengths.GROUP_NAME} testID="group-name" />
      <Field label={strings['groups.myName']} value={me} onChangeText={setMe} maxLength={config.profile.NAME_MAX_LENGTH} testID="group-my-name" />
      {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>{`${strings['common.error']} ${strings['common.offlineOnly']}`}</Text> : null}
      <Button label={strings['groups.create']} onPress={create} disabled={busy || name.trim() === '' || me.trim() === ''} testID="create-group" />
    </Screen>
  );
}
