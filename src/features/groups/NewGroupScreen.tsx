/** Nowa grupa (RPC create_group — wymaga internetu): nazwa i moje imię w tej grupie. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';

import { useServices } from '../../app/context';
import { DraftNote, useFormDraft } from '../../app/form-draft';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { nextStepsKey, starterListsOps } from '../../domain/views/starter';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Button, ErrorText, Field, Screen, Title } from '../../ui/components';
import { groupErrorText } from './server-errors';

type Props = NativeStackScreenProps<RootStackParams, 'NewGroup'>;

export function NewGroupScreen({ navigation, route }: Props) {
  const { account, newId, displayName, store, prefs } = useServices();
  const [name, setName] = useState(route.params?.name ?? '');
  const [me, setMe] = useState(displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Audyt 2 (R-27): te same identyfikatory przy ponowieniu — gdy odpowiedź serwera zginęła, druga próba nie tworzy
  // drugiej grupy, a serwer potwierdza istniejącą (create_group_with_owner, migracja 20261008360000).
  // D179 (audyt 2, M-123): szkic na telefonie — wyjście bez „Utwórz” zostawia wpisane pola (app/form-draft); nazwa
  // podana przy otwarciu (Pierwsze kroki) ma pierwszeństwo przed szkicem.
  const draft = useFormDraft('group:new', { name, me }, { name: setName, me: setMe }, { restore: route.params?.name === undefined });
  const [ids] = useState(() => ({ groupId: newId(), ownerMemberId: newId() }));

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await account.createGroup({ ...ids, name: name.trim(), displayName: me.trim() });
      draft.saved();
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
      <DraftNote draft={draft} />
      <Field label={strings['groups.name']} value={name} onChangeText={setName} autoFocus maxLength={config.lengths.GROUP_NAME} testID="group-name" />
      <Field label={strings['groups.myName']} value={me} onChangeText={setMe} maxLength={config.profile.NAME_MAX_LENGTH} testID="group-my-name" />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label={strings['groups.create']} onPress={create} disabled={busy || name.trim() === '' || me.trim() === ''} testID="create-group" />
    </Screen>
  );
}
