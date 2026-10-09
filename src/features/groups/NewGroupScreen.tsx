/** Nowa grupa (RPC create_group — wymaga internetu): nazwa i moje imię w tej grupie. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import type { TextInput } from 'react-native';

import { useServices } from '../../app/context';
import { useDefaultGroup } from '../../app/default-group';
import { DraftNote, useFormDraft } from '../../app/form-draft';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { nextStepsKey, starterListsOps } from '../../domain/views/starter';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Button, ErrorText, Field, Screen, Title, useFormError } from '../../ui/components';
import { groupErrorText } from './server-errors';

type Props = NativeStackScreenProps<RootStackParams, 'NewGroup'>;

export function NewGroupScreen({ navigation, route }: Props) {
  const { account, newId, displayName, store, prefs } = useServices();
  const defaultGroup = useDefaultGroup();
  const [name, setName] = useState(route.params?.name ?? '');
  const [me, setMe] = useState(displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError, attempt] = useFormError<string>();
  const myField = useRef<TextInput>(null);
  // Audyt 2 (R-27): te same identyfikatory przy ponowieniu — gdy odpowiedź serwera zginęła, druga próba nie tworzy
  // drugiej grupy, a serwer potwierdza istniejącą (create_group_with_owner, migracja 20261008360000).
  // D179 (audyt 2, M-123): szkic na telefonie — wyjście bez „Utwórz” zostawia wpisane pola (app/form-draft); nazwa
  // podana przy otwarciu (Pierwsze kroki) ma pierwszeństwo przed szkicem.
  const draft = useFormDraft('group:new', { name, me }, { name: setName, me: setMe }, { restore: route.params?.name === undefined });
  const [ids] = useState(() => ({ groupId: newId(), ownerMemberId: newId() }));

  // PWD-5 A (M-274): przycisk zawsze aktywny — po naciśnięciu komunikat, czego brakuje.
  const create = async () => {
    if (name.trim() === '') return setError(strings['groups.error.nameEmpty']);
    if (me.trim() === '') return setError(strings['groups.error.myNameEmpty']);
    setBusy(true);
    setError(null);
    try {
      await account.createGroup({ ...ids, name: name.trim(), displayName: me.trim() });
      draft.saved();
      // Decyzja właściciela z 8.10.2026 (PW-36 A): grupa z Pierwszych kroków dostaje od razu „Zakupy” i „Zadania”
      // (kolejka, jak każda nowa lista). Kartę „Następne kroki” (pamiętaną na tym telefonie) dostaje każda nowa grupa,
      // także z ekranu Grupy (audyt 2, M-117, zasada właściciela A).
      if (route.params?.starter) store.dispatch(starterListsOps(ids.groupId, newId));
      prefs?.set(nextStepsKey(ids.groupId), '1').catch(() => {});
      // Audyt 3 (N-45, decyzja Q14 A): nowa grupa zostaje ostatnio użytą — pierwsze wpisy z Moich spraw trafią do niej
      // (partner je zobaczy), a nie do „Osobistych”. Chip „Do: …” przy polu pokazuje to przed dodaniem.
      defaultGroup.remember(ids.groupId);
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
      {/* M-243: w formularzu z kilkoma polami Return przechodzi do następnego, w ostatnim — tworzy. */}
      <Field label={strings['groups.name']} value={name} onChangeText={(v) => (setName(v), setError(null))} autoFocus maxLength={config.lengths.GROUP_NAME} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => myField.current?.focus()} testID="group-name" />
      <Field ref={myField} label={strings['groups.myName']} value={me} onChangeText={(v) => (setMe(v), setError(null))} maxLength={config.profile.NAME_MAX_LENGTH} textContentType="givenName" autoComplete="name-given" returnKeyType="done" onSubmitEditing={() => void create()} testID="group-my-name" />
      {error ? <ErrorText attempt={attempt}>{error}</ErrorText> : null}
      <Button label={strings['groups.create']} onPress={create} busy={busy} testID="create-group" />
    </Screen>
  );
}
