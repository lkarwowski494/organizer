/**
 * Nowa lista: nazwa, rodzaj (zadania/zakupy), grupa, widoczność (D3: cała grupa albo tylko ja). Lista zakupów od razu
 * dostaje zakupy: dzień i osobę (D73; we wspólnej grupie jedno z nich obowiązkowe).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';

import { useAppData, useServices } from '../../app/context';
import { DraftNote, useFormDraft } from '../../app/form-draft';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { createList } from '../../domain/views/commands';
import { formGroups } from '../../domain/views/task-form';
import { startGroup } from '../../domain/views/default-group';
import { useDefaultGroup } from '../../app/default-group';
import { strings } from '../../i18n/strings.pl';
import { tripAdults, tripLacksAddressee, tripRequired } from '../../domain/views/shopping-trip';
import { BackButton, Body, Button, ErrorText, Field, Screen, SectionTitle, Segmented, Title } from '../../ui/components';
import { readTrip, type TripDraft, TripEditor } from './TripEditor';

type Props = NativeStackScreenProps<RootStackParams, 'NewList'>;

export function NewListScreen({ route, navigation }: Props) {
  const { userId, store, newId } = useServices();
  const { tables, today } = useAppData();
  // Audyt 2 (P-71, R-12): bez grup, w których jestem dzieckiem — serwer odrzuca nową listę (forbidden:child).
  const groups = useMemo(() => formGroups(tables, userId), [tables, userId]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'tasks' | 'shopping'>(route.params.kind ?? 'tasks');
  // PW-37 A (M-118, D191): bez wskazanej grupy — „Grupa domyślna” jak w szybkim dodawaniu; utworzenie zapamiętuje grupę.
  const defaultGroup = useDefaultGroup();
  const [groupId, setGroupId] = useState(route.params.groupId ?? startGroup(groups, defaultGroup.setting, defaultGroup.last) ?? '');
  const [visibility, setVisibility] = useState<'group' | 'private'>('group');
  const group = groups.find((g) => g.id === groupId);
  const personal = group?.kind === 'personal';
  const [draft, setDraft] = useState<TripDraft>({ date: '', time: '', responsibleId: null });
  // D179 (audyt 2, M-123): szkic na telefonie — wyjście bez „Utwórz” zostawia wpisane pola (app/form-draft).
  const saved = useFormDraft('list:new', { name, kind, groupId, visibility, trip: draft }, { name: setName, kind: setKind, groupId: setGroupId, visibility: setVisibility, trip: setDraft });
  const trip = readTrip(draft);
  const shopping = kind === 'shopping';
  const tripError = shopping && 'error' in trip ? trip.error : null;
  // D73: we wspólnej grupie osoba albo dzień; lista „Tylko ja” jak grupa osobista (PW-18 A).
  const tripNeeds = !!group && tripRequired(group.kind, personal ? 'group' : visibility);
  const tripMissing = shopping && 'trip' in trip && tripLacksAddressee(tripNeeds, trip.trip);

  // PWD-5 A (M-274): przycisk zawsze aktywny — po naciśnięciu komunikat, czego brakuje.
  const [error, setError] = useState<string | null>(null);
  const missing = name.trim() === '' ? strings['lists.error.nameEmpty'] : groupId === '' ? strings['form.error.group'] : tripError ? tripError : tripMissing ? strings['trip.required'] : null;
  const create = () => {
    if (missing) return setError(missing);
    const id = newId();
    saved.saved();
    defaultGroup.remember(groupId);
    store.dispatch(createList({ id, groupId, kind, name: name.trim(), visibility: personal ? 'group' : visibility, trip: shopping && 'trip' in trip ? trip.trip : undefined }));
    navigation.replace('List', { listId: id });
  };

  return (
    <Screen testID="screen-new-list">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{kind === 'shopping' ? strings['lists.newShopping'] : strings['lists.new']}</Title>
      <DraftNote draft={saved} />
      <Field label={strings['lists.name']} value={name} onChangeText={(v) => (setName(v), setError(null))} autoFocus maxLength={config.lengths.LIST_NAME} returnKeyType="done" testID="list-name" />
      <Segmented label={strings['lists.kindLabel']} value={kind} onChange={setKind} options={[{ value: 'tasks', label: strings['lists.kind.tasks'] }, { value: 'shopping', label: strings['lists.kind.shopping'] }]} />
      <Segmented label={strings['lists.group']} value={groupId} onChange={(g) => (setGroupId(g), setDraft({ ...draft, responsibleId: null }))} options={groups.map((g) => ({ value: g.id, label: g.kind === 'personal' ? strings['groups.personal'] : g.name }))} />
      {personal ? null : (
        <Segmented label={strings['lists.visibility']} value={visibility} onChange={(v) => (setVisibility(v), v === 'private' && draft.responsibleId !== group?.me.member_id && setDraft({ ...draft, responsibleId: null }))} options={[{ value: 'group', label: strings['lists.visibility.group'] }, { value: 'private', label: strings['lists.visibility.private'] }]} />
      )}
      {shopping && group ? (
        <>
          <SectionTitle>{strings['trip.section']}</SectionTitle>
          {/* Audyt 2 (R-3): lista „Tylko ja” — zakupy robię ja albo nikt konkretny (inną osobę serwer odrzuci). */}
          <TripEditor value={draft} onChange={setDraft} adults={tripAdults(tables, groupId, (m) => personal || visibility === 'group' || m === group.me.member_id)} today={today} required={tripNeeds} />
          {tripError ? <Body>{tripError}</Body> : null}
        </>
      ) : null}
      {error ? <ErrorText testID="list-error">{error}</ErrorText> : null}
      <Button label={strings['lists.create']} onPress={create} testID="create-list" />
    </Screen>
  );
}
