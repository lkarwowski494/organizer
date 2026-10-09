/**
 * Lista zadań albo zakupów: drzewo zadań (podzadania pod rodzicem), szybkie dodawanie na tę listę,
 * zrobione na dole („W koszyku” dla zakupów; na liście zadań zwinięte „Zrobione (N)”, starsze niż
 * config.lists.DONE_RECENT_DAYS dni na życzenie — audyt 3, N-52), na liście zakupów „Kupione w ostatnich zakupach”
 * (Q9 B, N-49). Pozycja jeszcze niewysłana ma dopisek „czeka na wysłanie”.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type ReactNode, useMemo, useState } from 'react';
import { Pressable, Text, type TextInput, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { NewOp } from '../../domain/sync-engine/client';
import { quickAddOps } from '../../domain/views/quick-add-ops';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { formatDue } from '../../domain/format';
import { parseQuickAdd } from '../../domain/quickadd';
import { parseQuantity } from '../../domain/quantity';
import { lacksAddressee } from '../../domain/views/addressee';
import { memberCanSeeList } from '../../domain/views/visibility';
import { usePullRefresh } from '../../app/TabHeader';
import { useTaskActions } from '../../app/task-actions';
import { patchTask, renameList } from '../../domain/views/commands';
import { checkOff, type DoneRow, groupsView, listDetail, myMemberships, splitDoneRows, type TaskNode } from '../../domain/views';
import { personOf } from '../../domain/views/who';
import { strings } from '../../i18n/strings.pl';
import { buttonA11y, useA11yFocus, useClosedPanel } from '../../ui/a11y';
import { BackButton, Body, Button, Card, Collapsible, ErrorText, Field, Glyph, QuickAddField, Screen, SectionTitle, StationRow, SwipeRow, SyncChip, Title, MissingScreen, GroupLine, META_SEP } from '../../ui/components';
import { useLiveText } from '../../ui/live-text';
import { QuickAddExtras } from '../../ui/QuickAddExtras';
import { AskPanel } from '../../ui/AskPanel';
import { extractMention } from '../../domain/views/mention';
import { extractTag, type ListResolution, type QuickAnswers, resolveListQuick } from '../../domain/views/quick-target';
import { useTheme } from '../../ui/theme';
import { useUndo } from '../../ui/undo';
import { cancelHandoff, createHandoff, handoffKey, handoffTargets, outgoingPending } from '../../domain/views/handoffs';
import { asTrip, boughtItems, buyAgainOps, hasTrip, planTrip, tripAdults, tripItems, tripLacksAddressee, tripRequired } from '../../domain/views/shopping-trip';
import { HandoffPicker } from '../handoffs/HandoffPicker';
import { addStaple, addStaplesOps, categoryMemory, categoryOf, duplicateOf, itemKey, missingStaples, removeStaple, sections, setCategory, staplesOf, suggestions } from '../../domain/views/shopping';
import { listMarks } from './ListsScreen';
import { BoughtSection, ItemPanel, stapleError, StaplesCard, Suggestions } from './ShoppingExtras';
import { readTrip, type TripDraft, TripEditor } from './TripEditor';

type ListAnswers = Pick<QuickAnswers, 'person' | 'skipMention'>;

type Props = NativeStackScreenProps<RootStackParams, 'List'>;

/**
 * Zwinięte minione kopie zadania powtarzanego (decyzja właściciela z 8.10.2026, audyt 2: PWD-14 A, M-283): jeden wiersz
 * „12 razy minęło” zamiast stosu wpisów w „Zrobione”; dotknięcie rozwija (jak zwinięte lekcje, D127).
 */
function ExpiredRunRow({ title, count, open, onPress, testID }: { title: string; count: number; open: boolean; onPress: () => void; testID: string }) {
  const { c, font, size } = useTheme();
  const meta = strings['lists.expiredRun'](count);
  // Audyt 2 (M-141): jak wiersz lekcji — stan i czynność dla VoiceOvera, na ekranie ˅/˄ zamiast „dotknij, by…”.
  return (
    <Pressable testID={testID} {...buttonA11y({ expanded: open })} accessibilityLabel={`${title}, ${meta}`} accessibilityHint={strings[open ? 'lists.runHideHint' : 'lists.runShowHint']} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60, gap: 6 }}>
      <View style={{ width: 30, alignItems: 'center' }}>
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: c.control }} />
      </View>
      <View style={{ flex: 1, paddingVertical: 10, gap: 3 }}>
        <Text style={{ fontFamily: font.text600, fontSize: size.BODY, lineHeight: size.BODY * 1.25, color: c.inkMuted }}>{title}</Text>
        <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{meta}</Text>
      </View>
      <Glyph name={open ? 'less' : 'more'} color={c.inkMuted} />
    </Pressable>
  );
}

/**
 * Sekcja zakupów: karta, a przy planowaniu — pola na tle ekranu, jak w formularzu nowej listy. W karcie mini kalendarz
 * miał dni po 39–41 pt (karta i panel zabierają szerokość; Apple HIG: „Default control size 44x44 pt”), na tle ekranu —
 * 44 pt przy 375 pt szerokości (audyt 3, N-193).
 */
function TripBox({ editing, children }: { editing: boolean; children: ReactNode }) {
  const { space } = useTheme();
  if (editing) return <View testID="trip" style={{ gap: space.CARD_GAP }}>{children}</View>;
  return <Card testID="trip">{children}</Card>;
}

export function ListScreen({ route, navigation }: Props) {
  const { userId, store, now, nowMs, newId } = useServices();
  const actions = useTaskActions();
  const undo = useUndo();
  const { tables, today, indicator, state } = useAppData();
  const refresh = usePullRefresh();
  const [text, setText] = useState('');
  const [ignore, setIgnore] = useState<{ start: number; end: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ r: Exclude<ListResolution, { kind: 'ok' }>; answers: ListAnswers } | null>(null);
  const [planning, setPlanning] = useState<TripDraft | null>(null);
  const [planTried, setPlanTried] = useState(false);
  const [handing, setHanding] = useState(false);
  // Audyt 3 (N-62): po zamknięciu panelu fokus VoiceOvera wraca na przycisk, który go otworzył (albo do pola po „Anuluj”).
  const handBack = useClosedPanel(handing) !== null;
  const [askCancelled, setAskCancelled] = useState(0);
  const quickInput = useA11yFocus<TextInput>(askCancelled, askCancelled > 0);
  const [picking, setPicking] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [openRuns, setOpenRuns] = useState<string[]>([]);
  // Audyt 3 (N-52): „Zrobione (N)” zwinięte, starsze niż config.lists.DONE_RECENT_DAYS — dopiero na życzenie.
  const [doneOpen, setDoneOpen] = useState(false);
  const [olderOpen, setOlderOpen] = useState(false);
  const [boughtOpen, setBoughtOpen] = useState(false);
  // Q8 A (N-7): ten sam produkt już na liście — pytanie pod polem zamiast cichego dubla.
  const [dup, setDup] = useState<{ value: string; hit: NonNullable<ReturnType<typeof duplicateOf>> } | null>(null);
  const detail = useMemo(() => listDetail(tables, userId, route.params.listId, today), [tables, userId, route.params.listId, today]);
  const pendingIds = useMemo(() => new Set(state.pending.filter((op) => op.seq > state.ackedSeq).flatMap((op) => ('id' in op ? [op.id] : []))), [state]);
  // Decyzja właściciela z 8.10.2026 (PW-17 B, M-107): nazwa listy do zmiany — zapis od razu (D130), jak tytuł zadania.
  const rename = useLiveText(detail?.list.name ?? '', (name) => detail && store.dispatch(renameList(detail.list.id, name)), { empty: strings['lists.error.nameEmpty'] });

  if (!detail) {
    return (
      <MissingScreen testID="screen-list-missing" text={strings['missing.list']} onBack={() => navigation.goBack()} />
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
  // PW-14 B: dziecko z kontem odhacza tylko swoje sprawy (serwer: forbidden:not_own) — reszta bez pola odhaczenia.
  const canCheck = checkOff(tables, userId);
  // D73: zakupy (dzień i osoba) — tylko na liście zakupów; dziecko ich nie planuje (serwer: lists_guard).
  const trip = asTrip(tables.lists?.[list.id] ?? {});
  const adults = tripAdults(tables, list.group_id);
  // Audyt 2 (U-30): jak w wierszu zakupów w Moich sprawach („dla Ciebie”, „dla: Ala”).
  const who = adults.some((m) => m.member_id === trip.responsibleId) ? personOf(tables, userId, trip.responsibleId) : null;
  // Audyt 2 (R-3): do wyboru tylko ci, którzy widzą listę. M-22: osoba usunięta z grupy (albo bez dostępu) to „Nikt
  // konkretny” (D132) — edytor nie dostaje wartości spoza swoich opcji.
  const pickable = adults.filter((m) => memberCanSeeList(tables, m.member_id, list.id));
  const tripPerson = pickable.some((m) => m.member_id === trip.responsibleId) ? trip.responsibleId : null;
  const tripMine = trip.responsibleId !== null && trip.responsibleId === me?.member_id;
  const waiting = outgoingPending(tables, userId).get(handoffKey('lists', list.id, null));
  const planned = planning ? readTrip(planning) : null;
  const groupKind = groupsView(tables, userId).find((g) => g.id === list.group_id)?.kind ?? 'shared';
  const planError = planned && 'error' in planned ? planned.error : null;
  const tripNeeds = tripRequired(groupKind, list.visibility);
  const planMissing = !!planned && 'trip' in planned && tripLacksAddressee(tripNeeds, planned.trip);
  const add = (value = text, assigneeId: string | null = null, ign = value === text ? ignore : [], again = false) => {
    // Decyzja właściciela (audyt 3: Q8 A, N-7): produkt, który już czeka albo leży w koszyku, nie dubluje się po cichu.
    const hit = shopping && !again ? duplicateOf(tables, list.id, value) : null;
    if (hit) return setDup({ value, hit });
    setDup(null);
    const ops = quickAddOps({ tables, userId, text: value, now: now(), ignore: ign, newId, listId: list.id, assigneeId });
    store.dispatch(ops);
    // D189 (audyt 2: PW-29 A, M-126): po szybkim dodaniu zadania „Dodano … · Zmień” — jak w Moich sprawach. Pozycje
    // zakupów dodaje się seriami, a dotknięcie pozycji już ją edytuje — bez paska.
    const created = ops.find((o) => o.kind === 'create' && o.entity === 'tasks');
    if (!shopping && created?.kind === 'create') undo.show(strings['form.added'](String(created.set.title), list.name), () => navigation.navigate('Task', { taskId: created.id }), strings['common.change']);
    setText('');
    setIgnore([]);
    setError(null);
    setAsk(null);
  };
  // Spójnie z Moimi sprawami (audyt 2): „@imię” przypisuje osobę, która widzi tę listę, „@ja” — mnie; kilka osób albo
  // żadna — pytanie pod polem. „#…” nie zmienia grupy (wyznacza ją lista) — podpowiedź pod polem, zostaje w nazwie.
  const proceed = (answers: ListAnswers) => {
    const r = resolveListQuick(tables, userId, list.id, text, answers);
    if (r.kind !== 'ok') return setAsk({ r, answers });
    add(r.body, r.memberId, ignore);
  };
  const tag = shopping ? null : (extractTag(text)?.name ?? null);
  // Lista zadań: rozpoznane fragmenty to chipy do odklikania (D18), jak w Moich sprawach. Zakupy — bez terminów (audyt 2, M-20).
  const parsed = shopping ? null : parseQuickAdd(text, now(), { ignore });
  // D68 po decyzji właściciela z 8.10.2026 (PW-18 b): zadanie bez osoby i terminu też się zapisuje, bez pytania —
  // jego wiersz mówi, że nikt go nie zobaczy w Moich sprawach (lists.noAddressee). Lista „Tylko ja” poza regułą (A).
  const submit = () => {
    if (text.trim() === '') return;
    // Audyt 2 (M-168): sam termin („jutro”) — nie ma czego dodać; pole zostaje z komunikatem.
    if (parsed && parseQuickAdd(extractMention(text).text, now()).title.trim() === '') return setError(strings['form.error.title']);
    if (shopping) return add();
    proceed({});
  };
  // D85, D86: działy, pamięć grupy, stałe zakupy (tylko dorośli zmieniają listę i działy; dziecko odhacza).
  const listRow = tables.lists?.[list.id] ?? {};
  const inCart = shopping ? tripItems(tables, list.id).inCart.length : 0;
  const handoffTo = tripMine && !waiting ? handoffTargets(tables, userId, list.group_id, list.id) : [];
  const staples = staplesOf(listRow);
  const memory = shopping ? categoryMemory(tables, list.group_id) : new Map();
  const editable = shopping && canDelete;
  const pick = (id: string | null) => (setPicking(id), setPickError(null));
  // D187: usunięcie stałej pozycji z „Cofnij” — wraca przez to samo polecenie co dodanie (na koniec listy stałych).
  const dropStaple = (name: string) => {
    const op = removeStaple(listRow, name);
    store.dispatch(op);
    const names = op.kind === 'cmd' ? (op.args.names as string[]) : [];
    undo.show(strings['undo.stapleRemoved'](name), { ops: names.map((n): NewOp => ({ kind: 'cmd', cmd: 'staple_add', args: { list_id: list.id, name: n } })) }, { changed: [op] });
  };
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
            // Audyt 3 (N-174): panel pozycji zamyka się, gdy pozycja idzie do koszyka (albo z niego wraca).
            onToggle={canCheck(t) ? () => (picking === t.id && pick(null), actions.toggle(t, shopping)) : undefined}
            onOpen={shopping ? (editable && !done ? () => pick(picking === t.id ? null : t.id) : undefined) : () => navigation.navigate('Task', { taskId: t.id })}
            openHint={shopping ? strings['shop.editHint'] : undefined}
            expanded={shopping && editable && !done ? picking === t.id : undefined}
          />
        </SwipeRow>,
        ...(picking === t.id && !done
          ? [
              <ItemPanel
                key={`pick-${t.id}`}
                title={t.title}
                onRename={(title) => store.dispatch(patchTask(t.id, { title }))}
                current={categoryOf(tables.tasks?.[t.id] ?? {}, memory)}
                isStaple={staples.some((s) => itemKey(s) === itemKey(t.title))}
                error={pickError}
                onPick={(cat) => (store.dispatch(setCategory(t.id, cat)), pick(null))}
                onToggleStaple={() => {
                  const has = staples.find((s) => itemKey(s) === itemKey(t.title));
                  if (has) dropStaple(has);
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

  const doneSplit = splitDoneRows(detail.doneRows, today);
  const doneRow = (r: DoneRow): React.ReactNode[] => {
    if (r.kind === 'task') return rows([r.node], true);
    const open = openRuns.includes(r.key);
    return [
      <ExpiredRunRow key={`run-${r.key}`} testID={`run-${r.key}`} title={r.title} count={r.nodes.length} open={open} onPress={() => setOpenRuns(open ? openRuns.filter((k) => k !== r.key) : [...openRuns, r.key])} />,
      ...(open ? rows(r.nodes, true, 1) : []),
    ];
  };

  return (
    <Screen testID="screen-list" refresh={refresh}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <BackButton onPress={() => navigation.goBack()} />
        <SyncChip indicator={indicator} nowMs={nowMs()} />
      </View>
      <Title>{list.name}</Title>
      <GroupLine name={list.groupName} line={list.line} detail={listMarks(list, detail.open.length).join(META_SEP)} />
      {shopping && canDelete ? (
        <TripBox editing={!!planning}>
          <SectionTitle>{strings['trip.section']}</SectionTitle>
          {planning ? (
            <>
              <TripEditor value={planning} onChange={setPlanning} adults={pickable} today={today} required={tripNeeds} />
              {/* PWD-5 A (M-274): przycisk aktywny, komunikat po naciśnięciu (podpowiedź „trip.required” stoi w edytorze). */}
              {planError ? <ErrorText testID="trip-error">{planError}</ErrorText> : planTried && planMissing ? <ErrorText testID="trip-error">{strings['trip.required']}</ErrorText> : null}
              <Button
                label={strings['trip.save']}
                testID="trip-save"
                onPress={() => {
                  if (planError || planMissing) return setPlanTried(true);
                  if (planned && 'trip' in planned) store.dispatch(planTrip(list.id, planned.trip));
                  setPlanning(null);
                  setPlanTried(false);
                }}
              />
              <Button kind="secondary" label={strings['common.cancel']} onPress={() => setPlanning(null)} />
            </>
          ) : hasTrip(trip) ? (
            <>
              <Body>{strings['trip.summary'](trip.date ? formatDue({ date: trip.date, time: trip.time }, today) : null, who)}</Body>
              <Button label={strings['trip.done']} testID="trip-done" onPress={() => actions.finishTrip(list.id, list.name)} />
              <Button kind="secondary" label={strings['trip.change']} testID="trip-change" onPress={() => setPlanning({ date: trip.date ?? '', time: trip.time?.slice(0, 5) ?? '', responsibleId: tripPerson })} />
              {/* Audyt 3 (N-172): bez osoby, która widzi listę („Tylko ja”) — nie ma komu przekazać, więc bez przycisku. */}
              {tripMine && (waiting || handoffTo.length > 0) ? (
                waiting ? (
                  <>
                    <Body>{strings['handoff.waiting'](waiting.otherName)}</Body>
                    <Button kind="secondary" label={strings['handoff.cancel']} testID="handoff-cancel" onPress={() => store.dispatch(cancelHandoff(waiting.id))} a11yFocus={handBack} />
                  </>
                ) : handing ? (
                  <HandoffPicker
                    targets={handoffTo}
                    onPick={(m) => {
                      store.dispatch(createHandoff({ id: newId(), groupId: list.group_id, entity: 'lists', entityId: list.id, toMember: m.member_id }));
                      setHanding(false);
                    }}
                    onCancel={() => setHanding(false)}
                  />
                ) : (
                  <Button kind="secondary" label={strings['trip.giveTrip']} testID="handoff-start" onPress={() => setHanding(true)} a11yFocus={handBack} />
                )
              ) : null}
            </>
          ) : (
            <>
              <Body muted>{strings['trip.none']}</Body>
              {/* Q8 A (N-7): zakupy bez planu też się kończą — kupione schodzą z listy, historia dostaje dzień zrobienia. */}
              {inCart > 0 ? <Button label={strings['trip.done']} testID="trip-done" onPress={() => actions.finishTrip(list.id, list.name)} /> : null}
              <Button kind="secondary" label={strings['trip.plan']} testID="trip-plan" onPress={() => setPlanning({ date: '', time: '', responsibleId: null })} />
            </>
          )}
        </TripBox>
      ) : null}
      {editable ? <StaplesCard list={listRow} missing={missingStaples(tables, list.id).length} onAddMissing={() => store.dispatch(addStaplesOps(tables, list.id, newId))} onEdit={(op) => store.dispatch(op)} onRemove={dropStaple} /> : null}
      {/* Dziecko (D34) tylko odhacza — bez usuwania listy; dopisuje tylko produkty na listę zakupów (audyt 3, Q6d A;
          serwer: tasks_guard z migracji 20261010120000). */}
      {canDelete || shopping ? (
        <QuickAddField inputRef={quickInput} value={text} onChangeText={(v) => (setText(v), setIgnore([]), setError(null), setAsk(null), setDup(null))} onSubmit={submit} placeholder={shopping ? strings['lists.addItem'] : strings['lists.addTask']}>
          {tag ? <Body muted>{strings['lists.tagHint'](tag)}</Body> : null}
          {parsed ? (
            <QuickAddExtras preview={{ tokens: parsed.tokens, event: false, unrecognizedDay: parsed.unrecognizedDay }} error={error} onUnclick={(t) => setIgnore([...ignore, { start: t.start, end: t.end }])} />
          ) : (
            <Suggestions names={suggestions(tables, list.group_id, list.id, text)} onPick={(name) => add(name)} />
          )}
        </QuickAddField>
      ) : null}
      {dup ? (
        <AskPanel
          testID="shop-duplicate"
          title={strings[dup.hit.inCart ? 'shop.dupInCart' : 'shop.dupWaiting'](parseQuantity(dup.hit.title).name)}
          options={[
            // Pole dodawania ma tylko dorosły, a dorosły odhacza każdą pozycję (PW-14 B dotyczy dziecka).
            ...(dup.hit.inCart ? [{ key: 'out', label: strings['shop.takeOutAgain'], onPress: () => (actions.toggle({ id: dup.hit.id, title: dup.hit.title, completed_at: 'x' }, true), setDup(null), setText('')) }] : []),
            { key: 'again', label: strings['shop.addAgain'], onPress: () => add(dup.value, null, [], true) },
          ]}
          onCancel={() => (setDup(null), setAskCancelled((k) => k + 1))}
        />
      ) : null}
      {ask?.r.kind === 'many' ? (
        <AskPanel
          testID="mention-choices"
          title={strings['mention.ask'](ask.r.name)}
          options={ask.r.targets.map((t) => ({ key: t.memberId, label: t.displayName, onPress: () => proceed({ ...ask.answers, person: t }) }))}
          onCancel={() => (setAsk(null), setAskCancelled((k) => k + 1))}
        />
      ) : ask?.r.kind === 'unknown' ? (
        <AskPanel
          testID="mention-unknown"
          title={strings['mention.unknownList'](ask.r.name)}
          body={strings['mention.unknownInfo'](ask.r.name)}
          options={[{ key: 'without', label: strings['mention.addWithout'], onPress: () => proceed({ ...ask.answers, skipMention: true }) }]}
          onCancel={() => (setAsk(null), setAskCancelled((k) => k + 1))}
        />
      ) : null}
      {detail.open.length === 0 && detail.done.length === 0 ? <Body muted>{shopping ? strings['lists.emptyShopping'] : strings['lists.emptyItems']}</Body> : null}
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
      {detail.done.length && shopping ? (
        <View>
          <SectionTitle>{strings['lists.inCart']}</SectionTitle>
          {detail.doneRows.flatMap(doneRow)}
        </View>
      ) : null}
      {detail.done.length && !shopping ? (
        <Collapsible title={strings['lists.doneCount'](detail.done.length)} open={doneOpen} onToggle={() => setDoneOpen(!doneOpen)} testID="list-done">
          {doneSplit.recent.flatMap(doneRow)}
          {doneSplit.older.length && !olderOpen ? <Button kind="secondary" label={strings['lists.showOlder'](doneSplit.older.length)} testID="list-done-older" onPress={() => setOlderOpen(true)} /> : null}
          {olderOpen ? doneSplit.older.flatMap(doneRow) : null}
        </Collapsible>
      ) : null}
      {editable ? <BoughtSection items={boughtItems(tables, list.id)} open={boughtOpen} onToggle={() => setBoughtOpen(!boughtOpen)} onBuyAgain={(b) => store.dispatch(buyAgainOps(b.id))} /> : null}
      {canDelete ? <Field label={strings['lists.name']} {...rename.field} maxLength={config.lengths.LIST_NAME} testID="list-rename" /> : null}
      {rename.error ? <ErrorText>{rename.error}</ErrorText> : null}
      {canDelete ? (
        // D187: lista z zadaniami pyta z ich liczbą, pusta — od razu; potem „Cofnij” i kosz.
        <Button kind="danger" label={strings['lists.delete']} testID="list-delete" onPress={() => actions.removeList(list, () => navigation.goBack())} />
      ) : null}
    </Screen>
  );
}
