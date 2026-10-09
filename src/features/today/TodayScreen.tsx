/**
 * „Moje sprawy” (D89) — rdzeń produktu: moje sprawy ze wszystkich grup na jednej liście, z kolorem grupy. Dzień / tydzień /
 * miesiąc ze strzałkami (wczoraj, jutro…), zaległe przechodzą na dziś z czerwonym znacznikiem (D61).
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, type TextInput, View } from 'react-native';

import { quickAddOps } from '../../domain/views/quick-add-ops';
import { quickEvent, quickEventOps, quickPreview } from '../../domain/views/quick-event';
import { type Nesting, nestEntries } from '../../domain/views/nesting';
import { moveOverdueOps } from '../../domain/views/overdue';
import { splitDuplicates } from '../../domain/views/calendar-sync';
import type { RootStackParams } from '../../app/routes';
import { useAppData, useServices } from '../../app/context';
import { formatLongDate, formatMinutes, formatMonth, formatRange, parseIsoDate } from '../../domain/format';
import { useTaskActions } from '../../app/task-actions';
import { useEventActions } from '../../app/event-actions';
import { localNow } from '../../domain/local-time';
import { type CivilDate, formatIsoDate } from '../../domain/civil-date';
import { groupsView } from '../../domain/views';
import { timeLabel } from '../../domain/views/events';
import { daySpan, isContinuation } from '../../domain/span';
import { occurrenceRow } from '../../ui/when';
import { rejectedCreateIds } from '../../domain/sync-engine/client';
import { expiredRepeatOps, missingRepeatOps } from '../../domain/views/task-repeat';
import { dayPlan, type Span } from '../../domain/views/day-plan';
import { closeHandoff, decideHandoff, declinedHandoffs, incomingHandoffs } from '../../domain/views/handoffs';
import { HandoffInbox } from '../handoffs/HandoffInbox';
import { PushPrompt } from './PushPrompt';
import { WhatsNew } from './WhatsNew';
import { NAME_ASKED } from '../profile/NameScreen';
import { WELCOME_SEEN } from '../welcome/WelcomeScreen';
import { startGroup } from '../../domain/views/default-group';
import { type QuickAnswers, quickGroups, type QuickResolution, type QuickTarget, resolveQuick, unseenInMyDays, withoutShortcuts } from '../../domain/views/quick-target';
import { useDefaultGroup } from '../../app/default-group';
import { QuickGroupChip, ShoppingChip } from './QuickGroupChip';
import { recentShoppingList, shoppingItem } from '../../domain/views/quick-shopping';
import { useUndo } from '../../ui/undo';
import { useDeviceCalendar } from '../../app/calendar-sync';
import { DeviceEventRow } from '../calendar/DeviceEventRow';
import { HiddenDuplicates } from '../calendar/HiddenDuplicates';
import { type MyEntry, myDays, onlyGroups, type RangeMode, rangeOf, shiftAnchor } from '../../domain/views/my-days';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, Collapsible, EventRow, GapRow, PeriodArrow, PeriodTitle, QuickAddField, Screen, SectionTitle, Segmented, StationRow, SwipeRow, Title } from '../../ui/components';
import { TabHeader, usePullRefresh } from '../../app/TabHeader';
import { GroupFilterBar, useGroupFilter } from '../../app/group-filter';
import { useMyScope } from '../../app/my-scope';
import { type RowTask, useRowMeta } from '../../app/row-meta';
import { AskPanel } from '../../ui/AskPanel';
import { QuickAddExtras } from '../../ui/QuickAddExtras';
import { announce, useA11yFocus } from '../../ui/a11y';
import { useTheme } from '../../ui/theme';

const MODES: RangeMode[] = ['day', 'week', 'month'];

export function TodayScreen() {
  const { userId, store, now, newId, prefs, needsName } = useServices();
  const actions = useTaskActions();
  const events = useEventActions();
  const { tables, today, state } = useAppData();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { c, font, size } = useTheme();
  const [text, setText] = useState('');
  const [ignore, setIgnore] = useState<{ start: number; end: number }[]>([]);
  // Pytanie pod polem przed dodaniem: kilka osób albo grup pasuje do „@…”/„#…” (D91), żadna (audyt 2, M-169, M-24).
  // `answers` — dotychczasowe odpowiedzi.
  const [ask, setAsk] = useState<{ r: Exclude<QuickResolution, { kind: 'ok' | 'noGroup' }>; answers: QuickAnswers } | null>(null);
  // Audyt 3 (N-62): po „Anuluj” w pytaniu pod polem fokus VoiceOvera wraca do pola (wybór dodaje wpis — fokus ma pasek).
  const [askCancelled, setAskCancelled] = useState(0);
  const quickInput = useA11yFocus<TextInput>(askCancelled, askCancelled > 0);
  // M-24: grupa wybrana chipem dla tego wpisu (null — start z ustawienia „Grupa domyślna”) i rozwinięty wybór.
  const [chip, setChip] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const defaultGroup = useDefaultGroup();
  // Audyt 2 (M-168): nie ma czego dodać (sam termin, samo „@imię”) — pole zostaje, komunikat zamiast cichego czyszczenia.
  const [error, setError] = useState<string | null>(null);
  // D127: rozwinięte wiersze lekcji dziecka (klucz wiersza).
  const [openLessons, setOpenLessons] = useState<string[]>([]);
  const undo = useUndo();
  // Zakres i dzień odniesienia (decyzja właściciela z 7.10.2026: przełącznik + strzałki, ADR 0009).
  const [mode, setMode] = useState<RangeMode>('day');
  const [anchor, setAnchor] = useState<CivilDate | null>(null);
  const at = anchor ?? today;

  const groups = useMemo(() => groupsView(tables, userId), [tables, userId]);
  // D133: minione „tylko tego dnia” z powtarzaniem dostają następne (od dziś) — raz, ten sam identyfikator na każdym telefonie.
  // Audyt 2: tylko w żywej grupie, w której nie jestem dzieckiem (T-2); odhaczone przez dziecko dostają następne
  // tutaj (T-12); kopia odrzucona przez serwer nie wraca w każdym cyklu synchronizacji.
  const rejectedIds = useMemo(() => rejectedCreateIds(state), [state.rejected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const canCreate = (g: string) => groups.some((x) => x.id === g && x.me.role !== 'child');
    const local = (iso: string) => formatIsoDate(localNow(Date.parse(iso)));
    const ops = [...expiredRepeatOps(tables, today, canCreate, rejectedIds), ...missingRepeatOps(tables, today, canCreate, local, rejectedIds)];
    if (ops.length) store.dispatch(ops);
  }, [tables, today, groups, store, rejectedIds]);
  // Pierwsze kroki (D79): przy pierwszym uruchomieniu na tym telefonie — wprowadzenie. Stan z chwili otwarcia
  // (useState): po nadaniu imienia sesja się zmienia, a ekran imienia sam przechodzi do wprowadzenia.
  const [askName] = useState(needsName);
  useEffect(() => {
    let live = true;
    prefs
      ?.get(WELCOME_SEEN)
      .then(async (v) => {
        if (!live) return;
        // D100: najpierw imię (konto bez imienia), potem wprowadzenie — ekran imienia sam do niego przechodzi.
        if (askName && (await prefs.get(NAME_ASKED)) !== '1') return live && nav.navigate('Name');
        if (v !== '1') nav.navigate('Welcome');
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [prefs, nav, askName]);
  // PW-2: zakres Moich spraw w grupach; PW-38: filtr grup chipami (oba pamiętane na tym telefonie).
  const { scopeOf } = useMyScope();
  const filterGroups = useMemo(() => groups.map((g) => ({ id: g.id, name: g.kind === 'personal' ? strings['groups.personal'] : g.name, line: g.line })), [groups]);
  const filter = useGroupFilter(filterGroups);
  const view = useMemo(
    () => onlyGroups(myDays(tables, userId, today, mode, at, (iso) => formatIsoDate(localNow(Date.parse(iso))), scopeOf), filter.active, mode),
    [tables, userId, today, mode, at, scopeOf, filter.active],
  );
  const refresh = usePullRefresh();
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const incoming = useMemo(() => incomingHandoffs(tables, userId), [tables, userId]);
  const declined = useMemo(() => declinedHandoffs(tables, userId), [tables, userId]);
  // D99: zakres godzin („17–18”) też jest chipem — odklikany zostaje zwykłym tekstem zadania. Podgląd mówi też, że powstanie
  // wydarzenie (audyt 2, M-256) albo że dnia nie rozpoznano (M-23).
  const preview = quickPreview(text, now(), ignore);
  // M-24 (decyzja właściciela 8.10.2026): chip pokazuje, dokąd trafi wpis — grupę z „#”/„@”, gdy tekst ją wskazał,
  // inaczej wybraną chipem albo start z ustawienia.
  const personalLabel = strings['groups.personal'];
  const addGroups = useMemo(() => quickGroups(tables, userId, personalLabel), [tables, userId, personalLabel]);
  const chipGroup = (chip !== null && addGroups.some((g) => g.id === chip) ? chip : null) ?? startGroup(addGroups, defaultGroup.setting, defaultGroup.last);
  const resolve = (answers: QuickAnswers) => resolveQuick(tables, userId, text, { chipGroupId: chipGroup, personalLabel, answers });
  const resolved = text ? resolve({}) : null;
  const target = resolved?.kind === 'ok' ? resolved.target : null;
  const shownGroup = groups.find((g) => g.id === (target?.groupId ?? chipGroup));
  const fromText = !!target && target.from !== 'chip';
  // PW-3 wariant D: cały wpis (bez terminu, „#…”, bez osoby) to produkt — podpowiedź listy zakupów grupy wpisu, której
  // ostatnio używano. Najpierw dosłownie („mąka 1.5 kg” z ilością), potem bez rozpoznanego terminu („mleko jutro”).
  const body = target ? quickPreview(target.body, now(), ignore) : null;
  const plain = target && target.memberId === null && !preview.event ? target : null;
  const product = plain && body ? (shoppingItem(plain.body) ?? shoppingItem(body.title)) : null;
  // D68 po PW-18 b: zapis bez pytania; przed dodaniem napis, że nikt tego nie zobaczy w Moich sprawach.
  const unseen = !!target && !!body && body.title.trim() !== '' && unseenInMyDays(tables, userId, target, body.dated);
  const shopList = plain && product ? recentShoppingList(tables, userId, plain.groupId) : null;
  const { from, to } = rangeOf(mode, at);
  const isoToday = formatIsoDate(today);
  const showsToday = formatIsoDate(from) <= isoToday && isoToday <= formatIsoDate(to);
  const label = mode === 'day' ? formatLongDate(at, today) : mode === 'week' ? formatRange(from, to, today) : formatMonth(at.y, at.m);

  // Szybkie dodanie (D90, D91, M-24): grupa z chipa, „#Grupa” albo „@imię”, osoba z „@imię”/„@ja”; po dodaniu pasek
  // „Dodano … · Zmień” otwiera ekran zadania (jedyny ekran zmiany zadania, D178). Użyte „#…”/„@…” są w `body` spacjami, więc odklikane fragmenty zostają.
  const addWith = (t: QuickTarget) => {
    const group = addGroups.find((g) => g.id === t.groupId)!.name;
    const q = quickEvent({ tables, userId, text: t.body, now: now(), ignore, groupId: t.groupId, memberId: t.memberId ?? undefined });
    const event = q ? quickEventOps(q, newId) : null;
    if (q && event) {
      // D99: zakres godzin = czas trwania = wydarzenie; „Zmień” otwiera wydarzenie.
      store.dispatch(event.ops);
      // D189 (audyt 2: PW-29 A, M-126): „Zmień” otwiera od razu edycję wydarzenia, jak „Zmień” zadania — formularz.
      undo.show(strings['form.addedEvent'](q.form.title, group), () => nav.navigate('EventEdit', { eventId: event.id, date: q.form.date, scope: 'all' }), strings['common.change']);
      return done(t);
    }
    const ops = quickAddOps({ tables, userId, text: t.body, now: now(), ignore, newId, groupId: t.groupId, assigneeId: t.memberId });
    const created = ops.find((o) => o.kind === 'create' && o.entity === 'tasks');
    if (!created || created.kind !== 'create') return fail(strings['common.error']);
    store.dispatch(ops);
    undo.show(strings['form.added'](String(created.set.title), group), () => nav.navigate('Task', { taskId: created.id }), strings['common.change']);
    done(t);
  };
  // Podpowiedź listy zakupów dotknięta: produkt na listę (tytuł dosłowny, M-20), pasek „Dodano … · Zmień” otwiera listę.
  const toShopping = (t: QuickTarget, item: string, list: { id: string; name: string }) => {
    const ops = quickAddOps({ tables, userId, text: item, now: now(), ignore: [], newId, listId: list.id });
    const created = ops.find((o) => o.kind === 'create' && o.entity === 'tasks');
    if (!created || created.kind !== 'create') return fail(strings['common.error']);
    store.dispatch(ops);
    undo.show(strings['form.addedItem'](String(created.set.title), list.name), () => nav.navigate('List', { listId: list.id }), strings['common.change']);
    done(t);
  };
  // „#Grupa” to wybór grupy jak chipem — zostaje ostatnio użytą (decyzja właściciela 8.10.2026).
  const done = (t: QuickTarget) => {
    if (t.from === 'tag') defaultGroup.remember(t.groupId);
    clear();
  };
  const fail = (message: string) => {
    setAsk(null);
    setError(message);
  };
  const clear = () => {
    setText('');
    setIgnore([]);
    setAsk(null);
    setError(null);
    setChip(null);
    setPicking(false);
  };
  const proceed = (answers: QuickAnswers) => {
    const r = resolve(answers);
    // Bez żadnej grupy (np. przed pierwszym pobraniem danych) nie ma gdzie dodać — tekst zostaje w polu.
    if (r.kind === 'noGroup') return fail(strings['common.error']);
    if (r.kind !== 'ok') return setAsk({ r, answers });
    addWith(r.target);
  };
  const submit = () => {
    if (text.trim() === '') return;
    // M-168: sam termin („jutro”) albo samo „@Ala”/„#Rodzina” — bez nazwy nie ma czego dodać.
    if (quickPreview(withoutShortcuts(text), now(), ignore).title.trim() === '') return fail(strings['form.error.title']);
    proceed({});
  };
  const canDelete = (groupId: string) => groups.find((g) => g.id === groupId)?.me.role !== 'child';
  const groupLabel = (id: string, name: string) => (groups.find((g) => g.id === id)?.kind === 'personal' ? strings['groups.personal'] : name);
  // PWD-13 A: „Bez terminu” w każdym zakresie, który obejmuje dziś (w tygodniu i miesiącu — zwinięte na górze).
  const pinned = showsToday ? view.pinned : [];
  const doneToday = showsToday ? view.doneToday : [];
  // D95: moje wydarzenia z iPhone'a (tylko na tym telefonie) — w każdym dniu zakresu, po sprawach grup; przy filtrze
  // grup (PW-38) schowane, bo nie należą do żadnej grupy.
  // D173: bez dubli wpisów aplikacji z tego samego dnia; ukryte — w wierszu „Ukryto N” pod dniem.
  const deviceAll = useDeviceCalendar().days;
  const allDevice = filter.active.size ? new Map<string, never[]>() : deviceAll;
  const deviceSplit = (d: (typeof view.days)[number]) =>
    splitDuplicates(allDevice.get(d.date) ?? [], d.entries.flatMap((x) => (x.kind === 'event' ? [{ title: x.event.title, time: x.event.startTime, continued: isContinuation(x.event.part) }] : x.kind === 'lessons' ? x.block.lessons.map((l) => ({ title: l.title, time: l.startTime })) : [{ title: x.task.title, time: x.task.due?.time ?? null }])));
  const deviceOf = (d: (typeof view.days)[number]) => deviceSplit(d).shown;
  const shownDay = (d: (typeof view.days)[number]) => d.entries.length > 0 || deviceOf(d).length > 0 || deviceSplit(d).hidden.length > 0;
  const firstPast = view.days.find((d) => d.past && shownDay(d))?.date;
  // D111: moje zaległe z własnym terminem i moje zaległe zakupy jednym dotknięciem na dziś (z cofnięciem); liczba spraw,
  // nie operacji (audyt 2: T-11, P-56; które są moje — decyzja właściciela z 8.10.2026, overdue.ts).
  const moveOverdueButton = (d: (typeof view.days)[number]) => {
    const overdue = d.entries.flatMap((x) => (x.kind === 'overdue' ? [x.task] : []));
    const { ops, undo: back, count } = moveOverdueOps(overdue, d.date, tables, groups);
    if (!count) return null;
    return (
      <Button
        kind="secondary"
        testID="move-overdue"
        label={strings['today.moveOverdue'](count)}
        onPress={() => {
          store.dispatch(ops);
          undo.show(strings['today.movedOverdue'](count), { ops: back }, { changed: ops });
        }}
      />
    );
  };
  const empty = pinned.length === 0 && doneToday.length === 0 && view.days.every((d) => d.entries.length === 0 && deviceOf(d).length === 0 && deviceSplit(d).hidden.length === 0);

  // M-128, M-129: opis wiersza wspólny z Kalendarzem (src/app/row-meta.ts).
  const meta = useRowMeta();
  const tripRow = (task: RowTask, key: string, day: string | null) => {
    const m = meta.task(task, day);
    // Zakupy z listy zakupów (D73): odhaczenie z potwierdzeniem i pytaniem o niekupione, dotknięcie otwiera listę.
    return (
      <StationRow
        key={key}
        testID={`today-trip-${task.id}`}
        title={strings['trip.title'](task.title)}
        line={task.line}
        group={groupLabel(task.group_id, task.groupName)}
        when={m.when}
        meta={m.meta}
        alert={m.alert}
        checked={false}
        // PW-14 B (audyt 2, R-11): dziecko z kontem widzi zakupy bez pola odhaczenia — serwer nie przyjmie ich zakończenia.
        onToggle={canDelete(task.group_id) ? () => actions.finishTrip(task.id, task.title) : undefined}
        onOpen={() => nav.navigate('List', { listId: task.id })}
      />
    );
  };
  // D104: podzadanie pod rodzicem (wcięcie), licznik u rodzica, dopisek rodzica, gdy go nie ma w tym dniu.
  // `day` — dzień listy (przy zadaniu z terminem tego dnia sama godzina, M-128); null — sekcje bez dnia.
  const taskRow = (task: RowTask, key: string, day: string | null, n?: Nesting) => {
    if (task.trip) return tripRow(task, key, day);
    const m = meta.task(task, day, n);
    return (
      // Audyt 2 (M-124): zrobione też można usunąć — jak na liście i w Kalendarzu (kosz i „Cofnij” chronią).
      <SwipeRow key={key} title={task.title} enabled={canDelete(task.group_id)} onDelete={() => actions.remove(task)} testID={`swipe-today-${task.id}`}>
        <StationRow
          testID={`today-${task.id}`}
          title={task.title}
          line={task.line}
          group={groupLabel(task.group_id, task.groupName)}
          when={m.when}
          meta={m.meta}
          depth={n?.depth}
          alert={m.alert}
          checked={task.completed_at !== null}
          onToggle={() => actions.toggle(task)}
          onOpen={() => nav.navigate('Task', { taskId: task.id })}
        />
      </SwipeRow>
    );
  };
  const lessonsRow = (x: Extract<MyEntry, { kind: 'lessons' }>, past: boolean) => {
    const open = openLessons.includes(x.key);
    const b = x.block;
    return (
      <Fragment key={x.key}>
        <EventRow
          testID={`today-${x.key}`}
          // Moje lekcje (dziecko z kontem, D127 — audyt 2, N-38) bez imienia.
          title={groups.find((g) => g.id === b.groupId)?.me.member_id === b.memberId ? strings['lessons.mine'](b.lessons.length) : strings['lessons.title'](b.name, b.lessons.length)}
          time={timeLabel(b.start, b.end)}
          line={b.line}
          group={groupLabel(b.groupId, b.groupName)}
          expanded={open}
          hint={open ? strings['lessons.hideHint'] : strings['lessons.showHint']}
          faded={past}
          onPress={() => (setOpenLessons(open ? openLessons.filter((k) => k !== x.key) : [...openLessons, x.key]), open || announce(strings['lessons.shown'](b.lessons.length)))}
        />
        {open ? b.lessons.map((l) => entryRow({ kind: 'event', key: `${x.key}-${l.eventId}`, event: l }, past, b.lessons[0]!.date)) : null}
      </Fragment>
    );
  };
  const entryRow = (x: MyEntry, past: boolean, day: string, n?: Nesting): React.JSX.Element => {
    if (x.kind === 'lessons') return lessonsRow(x, past);
    if (x.kind !== 'event') return taskRow(x.task, x.key, day, n);
    const m = meta.event(x.event, n);
    // PWD-32 B: wydarzenie dziecka, za które odpowiada ktoś inny — wyszarzone „Tymek: Basen”, z osobą odpowiedzialną.
    const info = !x.event.concernsMe && x.event.childInfo;
    return (
      // Audyt 2 (M-239): termin przesuwa się jak zadanie — jednorazowe „Usuń”, termin serii „Odwołaj” (tylko ten, D57).
      <SwipeRow key={x.key} title={x.event.title} enabled={canDelete(x.event.groupId)} action={x.event.recurring ? 'cancel' : 'delete'} onDelete={() => events.cancel(x.event.eventId, x.event.occurrenceDate)} testID={`swipe-today-event-${x.event.eventId}-${x.event.occurrenceDate}`}>
      <EventRow
        testID={`today-event-${x.event.eventId}-${x.event.occurrenceDate}`}
        title={info ? strings['event.childInfo'](info.join(', '), x.event.title) : x.event.title}
        // D199: wielodniowe w każdym dniu — „dzień 2 z 5”, kolejny dzień nocnego dyżuru „do 06:00”.
        {...occurrenceRow(x.event)}
        line={x.event.line}
        group={groupLabel(x.event.groupId, x.event.groupName)}
        alert={info ? undefined : m.alert}
        extra={m.extra}
        faded={past || !!info}
        onPress={() => nav.navigate('Event', { eventId: x.event.eventId, date: x.event.occurrenceDate })}
      />
      </SwipeRow>
    );
  };
  const pinnedRows = nestEntries(pinned.map((p) => ({ kind: 'task' as const, key: `p-${p.id}`, task: p })), tables).map((n) => taskRow(n.entry.task, n.entry.key, null, n));
  const spanOf = ({ entry: x }: { entry: MyEntry }): Span =>
    x.kind === 'event' ? daySpan(x.event.startTime, x.event.endTime, x.event.part) : x.kind === 'lessons' ? { start: x.block.start, end: x.block.end } : x.kind === 'task' ? { start: x.task.due?.time ?? null, end: null } : { start: null, end: null };
  const nowMin = now().hh * 60 + now().mm;

  return (
    <Screen testID="screen-today" refresh={refresh}>
      <TabHeader />
      <Title>{strings['tabs.today']}</Title>
      <GroupFilterBar groups={filterGroups} testID="today-filter" />
      <QuickAddField inputRef={quickInput} value={text} onChangeText={(s) => (setText(s), setIgnore([]), setAsk(null), setError(null))} onSubmit={submit} placeholder={strings['quick.placeholder']}>
        {(addGroups.length > 1 && shownGroup) || shopList ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {addGroups.length > 1 && shownGroup ? (
              <QuickGroupChip name={addGroups.find((g) => g.id === shownGroup.id)!.name} line={shownGroup.line} fromText={fromText} open={picking} onToggle={() => setPicking(!picking)} />
            ) : null}
            {plain && product && shopList ? <ShoppingChip item={product} list={shopList.name} onPress={() => toShopping(plain, product, shopList)} /> : null}
          </View>
        ) : null}
        {picking && !fromText && chipGroup ? (
          <Segmented
            label={strings['quick.groupPick']}
            value={chipGroup}
            options={addGroups.map((g) => ({ value: g.id, label: g.name }))}
            onChange={(g) => {
              // Zmiana chipem zostaje ostatnio użytą grupą (przy konkretnej grupie domyślnej — tylko dla tego wpisu).
              setChip(g);
              defaultGroup.remember(g);
              setPicking(false);
            }}
          />
        ) : null}
        {plain && product && !shopList ? <Body muted>{strings['quick.noShoppingList'](product, addGroups.find((g) => g.id === plain.groupId)!.name)}</Body> : null}
        {unseen ? <Body muted>{strings['quick.unseen']}</Body> : null}
        <QuickAddExtras preview={preview} error={error} onUnclick={(t) => setIgnore([...ignore, { start: t.start, end: t.end }])} />
      </QuickAddField>
      <Button
        kind="secondary"
        label={strings['form.more']}
        a11yHint={strings['form.moreHint']}
        testID="add-more"
        onPress={() => {
          // Z zakresem godzin — od razu formularz wydarzenia (D99) w grupie, którą pokazuje chip; osoba z „@…” tylko przy
          // jednym dopasowaniu (przy kilku pyta pełny formularz zadania, audyt 2 M-170).
          const q = quickEvent({ tables, userId, text: target?.body ?? text, now: now(), ignore, groupId: target?.groupId ?? chipGroup ?? undefined, memberId: target?.memberId ?? undefined });
          if (q) nav.navigate('EventEdit', { groupId: q.groupId, date: q.form.date, title: q.form.title, start: q.form.slots[0]!.start, end: q.form.slots[0]!.end, responsibleId: q.form.responsibleId ?? undefined });
          else nav.navigate('AddTask', { text, defaultGroupId: chipGroup ?? undefined });
          clear();
        }}
      />
      {ask?.r.kind === 'many' ? (
        <AskPanel
          testID="mention-choices"
          title={strings['mention.ask'](ask.r.name)}
          options={ask.r.targets.map((t) => ({ key: `${t.groupId}-${t.memberId}`, label: strings['mention.pick'](t.displayName, t.groupName), onPress: () => proceed({ ...ask.answers, person: t }) }))}
          onCancel={() => (setAsk(null), setAskCancelled((k) => k + 1))}
        />
      ) : ask?.r.kind === 'unknown' ? (
        <AskPanel
          testID="mention-unknown"
          title={strings['mention.unknown'](ask.r.name)}
          body={strings['mention.unknownInfo'](ask.r.name)}
          options={[{ key: 'without', label: strings['mention.addWithout'], onPress: () => proceed({ ...ask.answers, skipMention: true }) }]}
          onCancel={() => (setAsk(null), setAskCancelled((k) => k + 1))}
        />
      ) : ask?.r.kind === 'manyGroups' ? (
        <AskPanel
          testID="tag-choices"
          title={strings['tag.ask'](ask.r.name)}
          options={ask.r.groups.map((g) => ({ key: g.id, label: g.name, onPress: () => proceed({ ...ask.answers, group: g.id }) }))}
          onCancel={() => (setAsk(null), setAskCancelled((k) => k + 1))}
        />
      ) : ask?.r.kind === 'unknownGroup' ? (
        <AskPanel
          testID="tag-unknown"
          title={strings['tag.unknown'](ask.r.name)}
          body={strings['tag.unknownInfo'](ask.r.name, ask.r.chip.name)}
          options={[{ key: 'chip', label: strings['tag.addTo'](ask.r.chip.name), onPress: () => proceed({ ...ask.answers, skipTag: true }) }]}
          onCancel={() => (setAsk(null), setAskCancelled((k) => k + 1))}
        />
      ) : null}
      <Segmented label={strings['today.range']} value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m, label: strings[`today.range.${m}`] }))} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <PeriodArrow dir={-1} label={strings[`today.prev.${mode}`]} onPress={() => setAnchor(shiftAnchor(mode, at, -1))} />
        <PeriodTitle testID="today-range-label">{label}</PeriodTitle>
        <PeriodArrow dir={1} label={strings[`today.next.${mode}`]} onPress={() => setAnchor(shiftAnchor(mode, at, 1))} />
        {/* Stałe miejsce (D101): na bieżącym okresie wyszarzony, więc strzałki i nazwa okresu się nie przesuwają. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings['common.today']}
          accessibilityState={{ disabled: showsToday }}
          disabled={showsToday}
          testID="go-today"
          onPress={() => setAnchor(null)}
          style={{ minHeight: size.TOUCH_TARGET, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: c.control, opacity: showsToday ? 0.35 : 1 }}
        >
          <Text style={{ fontFamily: font.text700, fontSize: size.CONTROL, color: c.ink }}>{strings['common.today']}</Text>
        </Pressable>
      </View>
      {/* PWD-31 A: „Do potwierdzenia” (pilne) nad kartami informacyjnymi. */}
      <HandoffInbox incoming={incoming} declined={declined} today={today} onDecide={(h, accept) => store.dispatch(decideHandoff(h.id, accept))} onClose={(h) => store.dispatch(closeHandoff(h.id))} />
      <WhatsNew />
      <PushPrompt />
      {empty ? <Body muted>{showsToday && mode === 'day' ? strings['today.empty'] : strings['today.emptyRange']}</Body> : null}
      {pinned.length && mode === 'day' ? (
        <View>
          <SectionTitle>{strings['form.noDate']}</SectionTitle>
          {pinnedRows}
        </View>
      ) : pinned.length ? (
        <Collapsible title={strings['today.pinnedCount'](pinned.length)} open={pinnedOpen} onToggle={() => setPinnedOpen(!pinnedOpen)} testID="today-pinned">
          {pinnedRows}
        </Collapsible>
      ) : null}
      {view.days.map((d) =>
        !shownDay(d) ? null : (
          <View key={d.date} testID={`today-day-${d.date}`}>
            {mode === 'day' ? null : <SectionTitle>{d.isToday ? `${strings['common.today']} · ${formatLongDate(parseIsoDate(d.date), today)}` : formatLongDate(parseIsoDate(d.date), today)}</SectionTitle>}
            {/* Audyt 2 (U-63): wyjaśnienie minionych dni raz — pod pierwszym pokazanym minionym dniem, nie pod każdym. */}
            {d.past && d.date === firstPast ? <Body muted>{strings['today.pastInfo']}</Body> : null}
            {d.isToday ? moveOverdueButton(d) : null}
            {/* D122: wydarzenia z iPhone'a według godziny; w widoku dnia przerwy „wolne …” (dziś od teraz). */}
            {dayPlan(nestEntries(d.entries, tables), deviceOf(d), spanOf, { nowMin: d.isToday ? nowMin : null, gaps: mode === 'day' && !d.past }).map((r) =>
              r.kind === 'entry' ? entryRow(r.item.entry, d.past, d.date, r.item) : r.kind === 'device' ? <DeviceEventRow key={r.item.key} e={r.item} /> : <GapRow key={r.key} testID={`today-${r.key}`} length={formatMinutes(r.minutes)} />,
            )}
            <HiddenDuplicates entries={deviceSplit(d).hidden} testID={`today-hidden-${d.date}`} />
          </View>
        ),
      )}
      {/* PWD-7 A: odhaczone dziś — zwinięte, z możliwością odznaczenia. */}
      {doneToday.length ? (
        <Collapsible title={strings['today.doneToday'](doneToday.length)} open={doneOpen} onToggle={() => setDoneOpen(!doneOpen)} testID="today-done">
          {doneToday.map((x) => taskRow(x, `d-${x.id}`, null))}
        </Collapsible>
      ) : null}
    </Screen>
  );
}
