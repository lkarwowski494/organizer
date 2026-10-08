/**
 * Lista zadań albo zakupów: drzewo zadań (podzadania pod rodzicem), szybkie dodawanie na tę listę,
 * zrobione na dole („W koszyku” dla zakupów). Pozycja jeszcze niewysłana ma dopisek „czeka na wysłanie”.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import { quickAddOps } from '../../app/quickadd';
import type { RootStackParams } from '../../app/routes';
import { addDays, formatIsoDate } from '../../domain/civil-date';
import { formatDue } from '../../domain/format';
import { parseQuickAdd } from '../../domain/quickadd';
import { parseQuantity } from '../../domain/quantity';
import { addresseeRequired, lacksAddressee } from '../../domain/views/addressee';
import { memberCanSeeList } from '../../domain/views/visibility';
import { useTaskActions } from '../../app/task-actions';
import { remove, restore } from '../../domain/views/commands';
import { groupsView, listDetail, myMemberships, type TaskNode } from '../../domain/views';
import { personOf } from '../../domain/views/who';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, QuickAddField, Screen, SectionTitle, StationRow, SwipeRow, SyncChip, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { useUndo } from '../../ui/undo';
import { cancelHandoff, createHandoff, handoffKey, handoffTargets, outgoingPending } from '../../domain/views/handoffs';
import { asTrip, hasTrip, planTrip, tripAdults, tripLacksAddressee } from '../../domain/views/shopping-trip';
import { HandoffPicker } from '../handoffs/HandoffPicker';
import { addStaple, addStaplesOps, categoryMemory, categoryOf, itemKey, missingStaples, removeStaple, sections, setCategory, staplesOf, suggestions } from '../../domain/views/shopping';
import { openLabel } from './ListsScreen';
import { CategoryPicker, stapleError, StaplesCard, Suggestions } from './ShoppingExtras';
import { readTrip, type TripDraft, TripEditor } from './TripEditor';

type Props = NativeStackScreenProps<RootStackParams, 'List'>;

export function ListScreen({ route, navigation }: Props) {
  const { userId, store, now, nowMs, newId } = useServices();
  const actions = useTaskActions();
  const undo = useUndo();
  const { tables, today, indicator, state } = useAppData();
  const { c, font } = useTheme();
  const [text, setText] = useState('');
  const [ask, setAsk] = useState(false);
  const [planning, setPlanning] = useState<TripDraft | null>(null);
  const [handing, setHanding] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const detail = useMemo(() => listDetail(tables, userId, route.params.listId, today), [tables, userId, route.params.listId, today]);
  const pendingIds = useMemo(() => new Set(state.pending.filter((op) => op.seq > state.ackedSeq).flatMap((op) => ('id' in op ? [op.id] : []))), [state]);

  if (!detail) {
    return (
      <Screen testID="screen-list-missing">
        <BackButton onPress={() => navigation.goBack()} />
        <Body muted>{strings['common.error']}</Body>
      </Screen>
    );
  }
  const { list } = detail;
  const shopping = list.kind === 'shopping';
  // D34: dziecko tylko odhacza (serwer odrzuca usunięcie), więc nie dostaje przesuwania.
  const me = myMemberships(tables, userId).get(list.group_id);
  // D119: jak w Moich sprawach („dla Ciebie”, gdy to ja).
  const whoOf = (memberId: string | null) => {
    const p = personOf(tables, userId, memberId);
    return p ? [strings['who.task'](p)] : [];
  };
  const canDelete = me?.role !== 'child';
  // D73: zakupy (dzień i osoba) — tylko na liście zakupów; dziecko ich nie planuje (serwer: lists_guard).
  const trip = asTrip(tables.lists?.[list.id] ?? {});
  const adults = tripAdults(tables, list.group_id);
  const who = adults.find((m) => m.member_id === trip.responsibleId)?.display_name ?? null;
  // Audyt 2 (R-3): do wyboru tylko ci, którzy widzą listę. M-22: osoba usunięta z grupy (albo bez dostępu) to „Nikt
  // konkretny” (D132) — edytor nie dostaje wartości spoza swoich opcji.
  const pickable = adults.filter((m) => memberCanSeeList(tables, m.member_id, list.id));
  const tripPerson = pickable.some((m) => m.member_id === trip.responsibleId) ? trip.responsibleId : null;
  const tripMine = trip.responsibleId !== null && trip.responsibleId === me?.member_id;
  const waiting = outgoingPending(tables, userId).get(handoffKey('lists', list.id, null));
  const planned = planning ? readTrip(planning) : null;
  const groupKind = groupsView(tables, userId).find((g) => g.id === list.group_id)?.kind ?? 'shared';
  const planError = planned && 'error' in planned ? planned.error : null;
  const planMissing = !!planned && 'trip' in planned && tripLacksAddressee(groupKind, planned.trip);
  const add = (extra: { assigneeId?: string; dueDate?: string } = {}, value = text) => {
    store.dispatch(quickAddOps({ tables, userId, text: value, now: now(), ignore: [], newId, listId: list.id, ...extra }));
    setText('');
    setAsk(false);
  };
  // D68: we wspólnej grupie zadanie bez osoby i terminu nie zapisze się — najpierw wybór adresata.
  const submit = () => {
    const parsed = parseQuickAdd(text, now());
    if (parsed.title.trim() === '') return;
    if (!shopping && !parsed.due && addresseeRequired(tables, userId, list.id, null)) return setAsk(true);
    add();
  };
  const n = now();
  const day = (k: number) => formatIsoDate(addDays({ y: n.y, m: n.m, d: n.d }, k));
  // D85, D86: działy, pamięć grupy, stałe zakupy (tylko dorośli zmieniają listę i działy; dziecko odhacza).
  const listRow = tables.lists?.[list.id] ?? {};
  const staples = staplesOf(listRow);
  const memory = shopping ? categoryMemory(tables, list.group_id) : new Map();
  const editable = shopping && canDelete;
  const pick = (id: string | null) => (setPicking(id), setPickError(null));
  // Audyt 2 (M-82, T-7): pole zaznaczone tylko przy odhaczonym — minione ma dopisek „minęło” bez ptaszka. W zamkniętych
  // nie powtarzam otwartych podzadań: stoją w otwartych z dopiskiem rodzica (listDetail). Wcięcie według miejsca na ekranie.
  const rows = (nodes: TaskNode[], done: boolean, level = 0): React.ReactNode[] =>
    nodes
      .filter((t) => !done || t.closed)
      .flatMap((t) => [
        <SwipeRow key={t.id} title={t.title} enabled={canDelete} onDelete={() => actions.remove(t)} testID={`swipe-${t.id}`}>
          <StationRow
            testID={`task-${t.id}`}
            title={shopping ? parseQuantity(t.title).name : t.title}
            line={list.line}
            depth={level}
            meta={[
              ...(t.parentTitle ? [strings['nest.parent'](t.parentTitle, false)] : []),
              ...(shopping && parseQuantity(t.title).qty ? [parseQuantity(t.title).qty!] : []),
              ...(t.due ? [formatDue(t.due, today)] : []),
              ...(t.expired ? [strings['lists.expired']] : []),
              ...whoOf(t.assignee_member_id),
            ]}
            checked={t.completed_at !== null}
            pending={pendingIds.has(t.id)}
            alert={!done && t.completed_at === null && lacksAddressee(tables, userId, t) ? strings['lists.noAddressee'] : undefined}
            shopping={shopping}
            onToggle={() => actions.toggle(t, shopping)}
            onOpen={shopping ? (editable && !done ? () => pick(picking === t.id ? null : t.id) : undefined) : () => navigation.navigate('Task', { taskId: t.id })}
            openLabel={shopping ? strings['shop.pickCategory'](parseQuantity(t.title).name) : undefined}
          />
        </SwipeRow>,
        ...(picking === t.id
          ? [
              <CategoryPicker
                key={`pick-${t.id}`}
                item={t.title}
                current={categoryOf(tables.tasks?.[t.id] ?? {}, memory)}
                isStaple={staples.some((s) => itemKey(s) === itemKey(t.title))}
                error={pickError}
                onPick={(cat) => (store.dispatch(setCategory(t.id, cat)), pick(null))}
                onToggleStaple={() => {
                  const has = staples.find((s) => itemKey(s) === itemKey(t.title));
                  if (has) store.dispatch(removeStaple(listRow, has));
                  else {
                    const r = addStaple(listRow, t.title);
                    // Audyt 2 (M-224, R-21): błąd (pełna lista, za długa nazwa) jak w karcie stałych — panel zostaje otwarty.
                    if (!r.ok) return setPickError(stapleError(r.error));
                    store.dispatch(r.op);
                  }
                  pick(null);
                }}
                onClose={() => pick(null)}
              />,
            ]
          : []),
        ...rows(t.children, done, level + 1),
      ]);

  return (
    <Screen testID="screen-list">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <BackButton onPress={() => navigation.goBack()} />
        <SyncChip indicator={indicator} nowMs={nowMs()} />
      </View>
      <Title>{list.name}</Title>
      <Text style={{ fontFamily: font.text400, fontSize: 14, color: c.inkMuted }}>
        <Text style={{ fontFamily: font.text700 }}>{list.groupName}</Text>
        {`  ·  ${openLabel(list.kind, detail.open.length)}`}
      </Text>
      {shopping && canDelete ? (
        <View testID="trip" style={{ gap: 8, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
          <SectionTitle>{strings['trip.section']}</SectionTitle>
          {planning ? (
            <>
              <TripEditor value={planning} onChange={setPlanning} adults={pickable} today={today} required={groupKind === 'shared'} />
              {planError ? <Body>{planError}</Body> : null}
              <Button
                label={strings['trip.save']}
                testID="trip-save"
                disabled={!!planError || planMissing}
                onPress={() => {
                  if (planned && 'trip' in planned) store.dispatch(planTrip(list.id, planned.trip));
                  setPlanning(null);
                }}
              />
              <Button kind="secondary" label={strings['common.cancel']} onPress={() => setPlanning(null)} />
            </>
          ) : hasTrip(trip) ? (
            <>
              <Body>{strings['trip.summary'](trip.date ? formatDue({ date: trip.date, time: trip.time }, today) : null, who)}</Body>
              <Button label={strings['trip.done']} testID="trip-done" onPress={() => actions.finishTrip(list.id, list.name)} />
              <Button kind="secondary" label={strings['trip.change']} testID="trip-change" onPress={() => setPlanning({ date: trip.date ?? '', time: trip.time?.slice(0, 5) ?? '', responsibleId: tripPerson })} />
              {tripMine ? (
                waiting ? (
                  <>
                    <Body>{strings['handoff.waiting'](waiting.otherName)}</Body>
                    <Button kind="secondary" label={strings['handoff.cancel']} testID="handoff-cancel" onPress={() => store.dispatch(cancelHandoff(waiting.id))} />
                  </>
                ) : handing ? (
                  <HandoffPicker
                    targets={handoffTargets(tables, userId, list.group_id, list.id)}
                    onPick={(m) => {
                      store.dispatch(createHandoff({ id: newId(), groupId: list.group_id, entity: 'lists', entityId: list.id, toMember: m.member_id }));
                      setHanding(false);
                    }}
                    onCancel={() => setHanding(false)}
                  />
                ) : (
                  <Button kind="secondary" label={strings['trip.giveTrip']} testID="handoff-start" onPress={() => setHanding(true)} />
                )
              ) : null}
            </>
          ) : (
            <>
              <Body muted>{strings['trip.none']}</Body>
              <Button kind="secondary" label={strings['trip.plan']} testID="trip-plan" onPress={() => setPlanning({ date: '', time: '', responsibleId: null })} />
            </>
          )}
        </View>
      ) : null}
      {editable ? <StaplesCard list={listRow} missing={missingStaples(tables, list.id).length} onAddMissing={() => store.dispatch(addStaplesOps(tables, list.id, newId))} onEdit={(op) => store.dispatch(op)} /> : null}
      {/* Dziecko (D34) tylko odhacza — bez dodawania i usuwania listy. */}
      {canDelete ? (
        <QuickAddField value={text} onChangeText={(v) => (setText(v), setAsk(false))} onSubmit={submit} placeholder={shopping ? strings['lists.addItem'] : strings['lists.addTask']}>
          {shopping ? <Suggestions names={suggestions(tables, list.group_id, list.id, text)} onPick={(name) => add({}, name)} /> : null}
        </QuickAddField>
      ) : null}
      {ask ? (
        <View testID="addressee-ask" style={{ gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
          <Text accessibilityRole="header" style={{ fontFamily: font.text700, fontSize: 17, color: c.ink }}>
            {strings['addressee.ask']}
          </Text>
          <Body muted>{strings['addressee.why']}</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {detail.members.map((m) => (
              <Button key={m.member_id} kind="secondary" label={strings['addressee.for'](m.display_name)} onPress={() => add({ assigneeId: m.member_id })} />
            ))}
            <Button kind="secondary" label={strings['addressee.today']} onPress={() => add({ dueDate: day(0) })} />
            <Button kind="secondary" label={strings['addressee.tomorrow']} onPress={() => add({ dueDate: day(1) })} />
          </View>
          <Button kind="secondary" label={strings['common.cancel']} onPress={() => setAsk(false)} />
        </View>
      ) : null}
      {detail.open.length === 0 && detail.done.length === 0 ? <Body muted>{strings['lists.emptyItems']}</Body> : null}
      {shopping ? (
        sections(detail.open, tables, list.group_id).map((sec) => (
          <View key={sec.key} testID={`section-${sec.key}`}>
            <SectionTitle>{sec.name}</SectionTitle>
            {rows(sec.items, false)}
          </View>
        ))
      ) : (
        <View>{rows(detail.open, false)}</View>
      )}
      {detail.done.length ? (
        <View>
          <SectionTitle>{shopping ? strings['lists.inCart'] : strings['lists.done']}</SectionTitle>
          {rows(detail.done, true)}
        </View>
      ) : null}
      {canDelete ? (
        <Button
          kind="danger"
          label={strings['lists.delete']}
          onPress={() => {
            store.dispatch(remove('lists', list.id));
            undo.show(strings['undo.listDeleted'](list.name), () => store.dispatch(restore('lists', list.id)));
            navigation.goBack();
          }}
        />
      ) : null}
    </Screen>
  );
}
