/**
 * Nowa lista: nazwa, rodzaj (zadania/zakupy), grupa, widoczność (D3: cała grupa albo tylko ja). Lista zakupów od razu
 * dostaje zakupy: dzień i osobę (D73; we wspólnej grupie jedno z nich obowiązkowe).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { createList } from '../../domain/views/commands';
import { groupsView } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { tripAdults, tripLacksAddressee } from '../../domain/views/shopping-trip';
import { BackButton, Body, Button, Field, Screen, SectionTitle, Segmented, Title } from '../../ui/components';
import { readTrip, type TripDraft, TripEditor } from './TripEditor';

type Props = NativeStackScreenProps<RootStackParams, 'NewList'>;

export function NewListScreen({ route, navigation }: Props) {
  const { userId, store, newId } = useServices();
  const { tables, today } = useAppData();
  const groups = useMemo(() => groupsView(tables, userId), [tables, userId]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'tasks' | 'shopping'>(route.params.kind ?? 'tasks');
  const [groupId, setGroupId] = useState(route.params.groupId ?? groups[0]?.id ?? '');
  const [visibility, setVisibility] = useState<'group' | 'private'>('group');
  const group = groups.find((g) => g.id === groupId);
  const personal = group?.kind === 'personal';
  const [draft, setDraft] = useState<TripDraft>({ date: '', time: '', responsibleId: null });
  const trip = readTrip(draft);
  const shopping = kind === 'shopping';
  const tripError = shopping && 'error' in trip ? trip.error : null;
  const tripMissing = shopping && 'trip' in trip && !!group && tripLacksAddressee(group.kind, trip.trip);

  const create = () => {
    const id = newId();
    store.dispatch(createList({ id, groupId, kind, name: name.trim(), visibility: personal ? 'group' : visibility, trip: shopping && 'trip' in trip ? trip.trip : undefined }));
    navigation.replace('List', { listId: id });
  };

  return (
    <Screen testID="screen-new-list">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{kind === 'shopping' ? strings['lists.newShopping'] : strings['lists.new']}</Title>
      <Field label={strings['lists.name']} value={name} onChangeText={setName} autoFocus testID="list-name" />
      <Segmented label={strings['lists.kind.tasks'] + ' / ' + strings['lists.kind.shopping']} value={kind} onChange={setKind} options={[{ value: 'tasks', label: strings['lists.kind.tasks'] }, { value: 'shopping', label: strings['lists.kind.shopping'] }]} />
      <Segmented label={strings['lists.group']} value={groupId} onChange={(g) => (setGroupId(g), setDraft({ ...draft, responsibleId: null }))} options={groups.map((g) => ({ value: g.id, label: g.kind === 'personal' ? strings['groups.personal'] : g.name }))} />
      {personal ? null : (
        <Segmented label={strings['lists.visibility']} value={visibility} onChange={setVisibility} options={[{ value: 'group', label: strings['lists.visibility.group'] }, { value: 'private', label: strings['lists.visibility.private'] }]} />
      )}
      {shopping && group ? (
        <>
          <SectionTitle>{strings['trip.section']}</SectionTitle>
          <TripEditor value={draft} onChange={setDraft} adults={tripAdults(tables, groupId)} today={today} required={group.kind === 'shared'} />
          {tripError ? <Body>{tripError}</Body> : null}
        </>
      ) : null}
      <Button label={strings['lists.create']} onPress={create} disabled={name.trim() === '' || groupId === '' || !!tripError || tripMissing} testID="create-list" />
    </Screen>
  );
}
