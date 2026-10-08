/**
 * „Moje sprawy” (D89) — rdzeń produktu: moje sprawy ze wszystkich grup na jednej liście, z kolorem grupy. Dzień / tydzień /
 * miesiąc ze strzałkami (wczoraj, jutro…), zaległe przechodzą na dziś z czerwonym znacznikiem (D61).
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { config } from '../../config';
import { quickAddOps } from '../../app/quickadd';
import { quickEvent, quickEventOps, quickPreview } from '../../domain/views/quick-event';
import { type Nesting, nestEntries } from '../../domain/views/nesting';
import { moveOverdueOps } from '../../domain/views/overdue';
import { routineStreak, taskStreak } from '../../domain/views/routines';
import { withoutDuplicates } from '../../domain/views/calendar-sync';
import type { RootStackParams } from '../../app/routes';
import { useAppData, useServices } from '../../app/context';
import { formatDue, formatLongDate, formatMinutes, formatMonth, formatRange, parseIsoDate } from '../../domain/format';
import { useTaskActions } from '../../app/task-actions';
import { formatTime, localNow } from '../../app/clock';
import { useTravel } from '../../app/travel';
import { type CivilDate, formatIsoDate } from '../../domain/civil-date';
import { groupsView, type TodayItem } from '../../domain/views';
import { lengthLabel, timeLabel } from '../../domain/views/events';
import { personOf } from '../../domain/views/who';
import { expiredRepeatOps, missingRepeatOps } from '../../domain/views/task-repeat';
import { rsvpView } from '../../domain/views/rsvp';
import { dayPlan, type Span } from '../../domain/views/day-plan';
import { closeHandoff, decideHandoff, declinedHandoffs, incomingHandoffs } from '../../domain/views/handoffs';
import { HandoffInbox } from '../handoffs/HandoffInbox';
import { PushPrompt } from './PushPrompt';
import { WhatsNew } from './WhatsNew';
import { NAME_ASKED } from '../profile/NameScreen';
import { WELCOME_SEEN } from '../welcome/WelcomeScreen';
import { blankMention, type MentionResolution, type MentionTarget, resolveMention } from '../../domain/views/mention';
import { useUndo } from '../../ui/undo';
import { useDeviceCalendar } from '../../app/calendar-sync';
import { DeviceEventRow } from '../calendar/DeviceEventRow';
import { type MyEntry, myDays, type RangeMode, rangeOf, shiftAnchor } from '../../domain/views/my-days';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, EventRow, GapRow, LineChip, QuickAddField, Screen, SectionTitle, Segmented, StationRow, SwipeRow, SyncChip, Title } from '../../ui/components';
import { AskPanel } from '../../ui/AskPanel';
import { QuickAddExtras } from '../../ui/QuickAddExtras';
import { useTheme } from '../../ui/theme';

const MODES: RangeMode[] = ['day', 'week', 'month'];

export function TodayScreen() {
  const { userId, store, now, nowMs, newId, prefs, needsName } = useServices();
  const actions = useTaskActions();
  const { tables, today, indicator, state } = useAppData();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { c, font, size } = useTheme();
  const [text, setText] = useState('');
  const [ignore, setIgnore] = useState<{ start: number; end: number }[]>([]);
  // D91: „@imię” pasujące do kilku osób — wybór osoby i grupy przed dodaniem; żadnej — pytanie, czy bez osoby (audyt 2, M-169).
  const [ask, setAsk] = useState<Extract<MentionResolution, { kind: 'many' | 'unknown' }> | null>(null);
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
  const rejectedIds = useMemo(() => new Set(state.rejected.flatMap((r) => (r.op.kind === 'create' ? [r.op.id] : []))), [state.rejected]);
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
  const view = useMemo(() => myDays(tables, userId, today, mode, at, (iso) => formatIsoDate(localNow(Date.parse(iso)))), [tables, userId, today, mode, at]);
  const incoming = useMemo(() => incomingHandoffs(tables, userId), [tables, userId]);
  const declined = useMemo(() => declinedHandoffs(tables, userId), [tables, userId]);
  // D99: zakres godzin („17–18”) też jest chipem — odklikany zostaje zwykłym tekstem zadania. Podgląd mówi też, że powstanie
  // wydarzenie (audyt 2, M-256) albo że dnia nie rozpoznano (M-23).
  const preview = quickPreview(text, now(), ignore);
  const { from, to } = rangeOf(mode, at);
  const isoToday = formatIsoDate(today);
  const showsToday = formatIsoDate(from) <= isoToday && isoToday <= formatIsoDate(to);
  const label = mode === 'day' ? formatLongDate(at, today) : mode === 'week' ? formatRange(from, to, today) : formatMonth(at.y, at.m);

  // Szybkie dodanie (D90, D91): „@imię” wybiera grupę i osobę; po dodaniu pasek „Dodano … · Zmień” otwiera pełny formularz.
  const addWith = (target?: MentionTarget) => {
    // „@imię” zastępujemy spacjami tej samej długości, żeby odklikane fragmenty (ignore) zachowały pozycje.
    const body = target ? blankMention(text) : text;
    const group = target ? target.groupName : strings['groups.personal'];
    const q = quickEvent({ tables, userId, text: body, now: now(), ignore, groupId: target?.groupId, memberId: target?.memberId });
    const event = q ? quickEventOps(q, newId) : null;
    if (q && event) {
      // D99: zakres godzin = czas trwania = wydarzenie; „Zmień” otwiera wydarzenie.
      store.dispatch(event.ops);
      undo.show(strings['form.addedEvent'](q.form.title, group), () => nav.navigate('Event', { eventId: event.id, date: q.form.date }), strings['form.change']);
      return clear();
    }
    const ops = quickAddOps({ tables, userId, text: body, now: now(), ignore, newId, groupId: target?.groupId, assigneeId: target?.memberId });
    const created = ops.find((o) => o.kind === 'create' && o.entity === 'tasks');
    // Bez żadnej grupy (np. przed pierwszym pobraniem danych) nie ma gdzie dodać — tekst zostaje w polu.
    if (!created || created.kind !== 'create') return (setAsk(null), setError(strings['common.error']));
    store.dispatch(ops);
    undo.show(strings['form.added'](String(created.set.title), group), () => nav.navigate('AddTask', { taskId: created.id }), strings['form.change']);
    clear();
  };
  const clear = () => {
    setText('');
    setIgnore([]);
    setAsk(null);
    setError(null);
  };
  const submit = () => {
    if (text.trim() === '') return;
    const r = resolveMention(tables, userId, text);
    // M-168: sam termin („jutro”) albo samo „@Ala” — bez nazwy nie ma czego dodać.
    if (quickPreview(r.kind === 'one' || r.kind === 'many' ? blankMention(text) : text, now(), ignore).title.trim() === '') return setError(strings['form.error.title']);
    if (r.kind === 'many' || r.kind === 'unknown') return setAsk(r);
    addWith(r.kind === 'one' ? r.target : undefined);
  };
  const canDelete = (groupId: string) => groups.find((g) => g.id === groupId)?.me.role !== 'child';
  const groupLabel = (id: string, name: string) => (groups.find((g) => g.id === id)?.kind === 'personal' ? strings['groups.personal'] : name);
  const pinned = mode === 'day' && showsToday ? view.pinned : [];
  // D95: moje wydarzenia z iPhone'a (tylko na tym telefonie) — w każdym dniu zakresu, po sprawach grup.
  // D107: bez dubli wpisów aplikacji z tego samego dnia.
  const allDevice = useDeviceCalendar().days;
  const deviceOf = (d: (typeof view.days)[number]) =>
    withoutDuplicates(allDevice.get(d.date) ?? [], d.entries.flatMap((x) => (x.kind === 'event' ? [{ title: x.event.title, time: x.event.startTime }] : x.kind === 'lessons' ? x.block.lessons.map((l) => ({ title: l.title, time: l.startTime })) : [{ title: x.task.title, time: x.task.due?.time ?? null }])));
  // D111: zaległe z własnym terminem jednym dotknięciem na dziś (z cofnięciem).
  const moveOverdueButton = (d: (typeof view.days)[number]) => {
    const overdue = d.entries.flatMap((x) => (x.kind === 'overdue' ? [x.task] : []));
    const { ops, undo: back } = moveOverdueOps(overdue, d.date, tables);
    if (!ops.length) return null;
    return (
      <Button
        kind="secondary"
        testID="move-overdue"
        label={strings['today.moveOverdue'](ops.length)}
        onPress={() => {
          store.dispatch(ops);
          undo.show(strings['today.movedOverdue'](ops.length), () => store.dispatch(back));
        }}
      />
    );
  };
  const empty = pinned.length === 0 && view.days.every((d) => d.entries.length === 0 && deviceOf(d).length === 0);

  // D119: kto w każdym wierszu („Ty”, gdy to ja).
  const whoTask = (memberId: string | null) => {
    const p = personOf(tables, userId, memberId);
    return p ? [strings['who.task'](p)] : [];
  };
  // D124: ile osób potwierdziło obecność.
  const rsvpOf = (eventId: string, date: string) => {
    const v = rsvpView(tables, userId, eventId, date);
    // D129: w wierszu tylko, gdy ktoś nie będzie (reszta w szczegółach).
    return v && v.counts.no ? [strings['rsvp.short'](v.counts)] : [];
  };
  const whoEvent = (memberId: string | null) => {
    const p = personOf(tables, userId, memberId);
    return p ? [strings['who.event'](p)] : [];
  };
  const tripRow = (task: TodayItem & { trip: { open: number } }, key: string, alert?: string) => (
    // Zakupy z listy zakupów (D73): odhaczenie z potwierdzeniem i pytaniem o niekupione, dotknięcie otwiera listę.
    <StationRow
      key={key}
      testID={`today-trip-${task.id}`}
      title={strings['trip.title'](task.title)}
      line={task.line}
      group={groupLabel(task.group_id, task.groupName)}
      meta={[task.due ? formatDue(task.due, today) : strings['today.noDue'], strings['trip.open'](task.trip.open), ...whoTask(task.assignee_member_id)]}
      alert={alert}
      checked={false}
      onToggle={() => actions.finishTrip(task.id, task.title)}
      onOpen={() => nav.navigate('List', { listId: task.id })}
    />
  );
  // D104: podzadanie pod rodzicem (wcięcie), licznik u rodzica, dopisek rodzica, gdy go nie ma w tym dniu.
  // D117: „Wyjdź o …” przy dzisiejszym wydarzeniu z miejscem.
  const travel = useTravel();
  const leaveOf = (eventId: string, occ: string) => {
    const i = travel.info(eventId, occ);
    return i ? [strings['travel.leave'](formatTime(i.leaveMs), i.minutes, strings[`travel.mode.${i.mode}`])] : [];
  };
  // D114: seria (od 2 z rzędu) przy rutynie i zadaniu powtarzanym.
  const streakOf = (k: number) => (k >= config.streak.MIN_SHOWN ? [strings['streak'](k)] : []);
  const nestMeta = (n?: Nesting) => [
    ...(n?.parent ? [strings['nest.parent'](n.parent.title, n.parent.kind === 'event')] : []),
    ...(n?.progress ? [strings['nest.progress'](n.progress.done, n.progress.total)] : []),
  ];
  const taskRow = (task: TodayItem, key: string, alert?: string, n?: Nesting) => task.trip ? tripRow({ ...task, trip: task.trip }, key, alert) : (
    <SwipeRow key={key} title={task.title} enabled={canDelete(task.group_id) && task.completed_at === null} onDelete={() => actions.remove(task)}>
      <StationRow
        testID={`today-${task.id}`}
        title={task.title}
        line={task.line}
        group={groupLabel(task.group_id, task.groupName)}
        meta={[...nestMeta(n), task.due ? formatDue(task.due, today) : strings['today.noDue'], ...whoTask(task.assignee_member_id), ...streakOf(taskStreak(tables, task.id, (iso) => formatIsoDate(localNow(Date.parse(iso)))))]}
        depth={n?.depth}
        alert={alert}
        checked={task.completed_at !== null}
        onToggle={() => actions.toggle(task)}
        onOpen={() => nav.navigate('Task', { taskId: task.id })}
      />
    </SwipeRow>
  );
  const lessonsRow = (x: Extract<MyEntry, { kind: 'lessons' }>, past: boolean) => {
    const open = openLessons.includes(x.key);
    const b = x.block;
    return (
      <Fragment key={x.key}>
        <EventRow
          testID={`today-${x.key}`}
          title={strings['lessons.title'](b.name, b.lessons.length)}
          time={timeLabel(b.start, b.end)}
          line={b.line}
          group={groupLabel(b.groupId, b.groupName)}
          recurring={false}
          extra={open ? strings['lessons.hide'] : strings['lessons.show']}
          faded={past}
          onPress={() => setOpenLessons(open ? openLessons.filter((k) => k !== x.key) : [...openLessons, x.key])}
        />
        {open ? b.lessons.map((l) => entryRow({ kind: 'event', key: `${x.key}-${l.eventId}`, event: l }, past)) : null}
      </Fragment>
    );
  };
  const entryRow = (x: MyEntry, past: boolean, n?: Nesting): React.JSX.Element =>
    x.kind === 'lessons' ? (
      lessonsRow(x, past)
    ) : x.kind === 'event' ? (
      <EventRow
        key={x.key}
        testID={`today-event-${x.event.eventId}-${x.event.occurrenceDate}`}
        title={x.event.title}
        time={timeLabel(x.event.startTime, x.event.endTime)}
        length={lengthLabel(x.event.startTime, x.event.endTime)}
        line={x.event.line}
        group={groupLabel(x.event.groupId, x.event.groupName)}
        recurring={x.event.recurring}
        alert={leaveOf(x.event.eventId, x.event.occurrenceDate)[0]}
        extra={[...whoEvent(x.event.responsibleId), ...rsvpOf(x.event.eventId, x.event.occurrenceDate), ...(n?.progress ? [strings['nest.progress'](n.progress.done, n.progress.total)] : []), ...streakOf(routineStreak(tables, x.event.eventId, today))].join('  ·  ') || undefined}
        faded={past}
        onPress={() => nav.navigate('Event', { eventId: x.event.eventId, date: x.event.occurrenceDate })}
      />
    ) : x.kind === 'overdue' ? (
      taskRow(x.task, x.key, strings['today.overdueDays'](x.task.overdueDays), n)
    ) : (
      taskRow(x.task, x.key, undefined, n)
    );
  const spanOf = ({ entry: x }: { entry: MyEntry }): Span =>
    x.kind === 'event' ? { start: x.event.startTime, end: x.event.endTime } : x.kind === 'lessons' ? { start: x.block.start, end: x.block.end } : x.kind === 'task' ? { start: x.task.due?.time ?? null, end: null } : { start: null, end: null };
  const nowMin = now().hh * 60 + now().mm;
  const arrow = (k: number, a11y: string, glyph: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={() => setAnchor(shiftAnchor(mode, at, k))} style={{ width: size.TOUCH_TARGET, height: size.TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 26, color: c.ink }}>{glyph}</Text>
    </Pressable>
  );

  return (
    <Screen testID="screen-today">
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={strings['settings.open']} onPress={() => nav.navigate('Settings')} style={{ minHeight: 44, justifyContent: 'center' }}>
          <SyncChip indicator={indicator} nowMs={nowMs()} />
        </Pressable>
      </View>
      <Title>{strings['today.title']}</Title>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {groups.map((g) => (
          <LineChip key={g.id} name={g.kind === 'personal' ? strings['groups.personal'] : g.name} line={g.line} />
        ))}
      </View>
      <QuickAddField value={text} onChangeText={(s) => (setText(s), setIgnore([]), setAsk(null), setError(null))} onSubmit={submit} placeholder={strings['quick.placeholder']}>
        <QuickAddExtras preview={preview} error={error} onUnclick={(t) => setIgnore([...ignore, { start: t.start, end: t.end }])} />
      </QuickAddField>
      <Button
        kind="secondary"
        label={strings['form.more']}
        a11yHint={strings['form.moreHint']}
        testID="add-more"
        onPress={() => {
          // Z zakresem godzin — od razu formularz wydarzenia (D99); „@imię” wybiera tam grupę tylko przy jednym dopasowaniu
          // (przy kilku pyta pełny formularz zadania, audyt 2 M-170).
          const r = resolveMention(tables, userId, text);
          const one = r.kind === 'one' ? r.target : undefined;
          const q = quickEvent({ tables, userId, text: one ? blankMention(text) : text, now: now(), ignore, groupId: one?.groupId, memberId: one?.memberId });
          if (q) nav.navigate('EventEdit', { groupId: q.groupId, date: q.form.date, title: q.form.title, start: q.form.slots[0]!.start, end: q.form.slots[0]!.end, responsibleId: q.form.responsibleId ?? undefined });
          else nav.navigate('AddTask', { text });
          clear();
        }}
      />
      {ask?.kind === 'many' ? (
        <AskPanel
          testID="mention-choices"
          title={strings['mention.ask'](ask.name)}
          options={ask.targets.map((t) => ({ key: `${t.groupId}-${t.memberId}`, label: strings['mention.pick'](t.displayName, t.groupName), onPress: () => addWith(t) }))}
          onCancel={() => setAsk(null)}
        />
      ) : ask?.kind === 'unknown' ? (
        <AskPanel
          testID="mention-unknown"
          title={strings['mention.unknown'](ask.name)}
          body={strings['mention.unknownInfo'](ask.name)}
          options={[{ key: 'without', label: strings['mention.addWithout'], onPress: () => addWith() }]}
          onCancel={() => setAsk(null)}
        />
      ) : null}
      <Segmented label={strings['today.range']} value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m, label: strings[`today.range.${m}`] }))} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {arrow(-1, strings[`today.prev.${mode}`], '‹')}
        <Text accessibilityRole="header" testID="today-range-label" style={{ flex: 1, textAlign: 'center', fontFamily: font.display700, fontSize: 18, color: c.ink }}>
          {label}
        </Text>
        {arrow(1, strings[`today.next.${mode}`], '›')}
        {/* Stałe miejsce (D101): na bieżącym okresie wyszarzony, więc strzałki i nazwa okresu się nie przesuwają. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings['today.goToday']}
          accessibilityState={{ disabled: showsToday }}
          disabled={showsToday}
          testID="go-today"
          onPress={() => setAnchor(null)}
          style={{ minHeight: size.TOUCH_TARGET, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: c.control, opacity: showsToday ? 0.35 : 1 }}
        >
          <Text style={{ fontFamily: font.text700, fontSize: 15, color: c.ink }}>{strings['today.goToday']}</Text>
        </Pressable>
      </View>
      <WhatsNew />
      <PushPrompt />
      <HandoffInbox incoming={incoming} declined={declined} today={today} onDecide={(h, accept) => store.dispatch(decideHandoff(h.id, accept))} onClose={(h) => store.dispatch(closeHandoff(h.id))} />
      {empty ? <Body muted>{showsToday && mode === 'day' ? strings['today.empty'] : strings['today.emptyRange']}</Body> : null}
      {pinned.length ? (
        <View>
          <SectionTitle>{strings['today.pinned']}</SectionTitle>
          {nestEntries(pinned.map((p) => ({ kind: 'task' as const, key: `p-${p.id}`, task: p })), tables).map((n) => taskRow(n.entry.task, n.entry.key, undefined, n))}
        </View>
      ) : null}
      {view.days.map((d) =>
        d.entries.length === 0 && deviceOf(d).length === 0 ? null : (
          <View key={d.date} testID={`today-day-${d.date}`}>
            {mode === 'day' ? null : <SectionTitle>{d.isToday ? `${strings['today.today']} · ${formatLongDate(parseIsoDate(d.date), today)}` : formatLongDate(parseIsoDate(d.date), today)}</SectionTitle>}
            {d.past ? <Body muted>{strings['today.pastInfo']}</Body> : null}
            {d.isToday ? moveOverdueButton(d) : null}
            {/* D122: wydarzenia z iPhone'a według godziny; w widoku dnia przerwy „wolne …” (dziś od teraz). */}
            {dayPlan(nestEntries(d.entries, tables), deviceOf(d), spanOf, { nowMin: d.isToday ? nowMin : null, gaps: mode === 'day' && !d.past }).map((r) =>
              r.kind === 'entry' ? entryRow(r.item.entry, d.past, r.item) : r.kind === 'device' ? <DeviceEventRow key={r.item.key} e={r.item} /> : <GapRow key={r.key} testID={`today-${r.key}`} length={formatMinutes(r.minutes)} />,
            )}
          </View>
        ),
      )}
    </Screen>
  );
}
