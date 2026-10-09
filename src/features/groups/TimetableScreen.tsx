/**
 * Plan lekcji osoby z tygodniami A/B (D112, ADR 0027): lekcje pon.–pt. (i weekend, gdy ma lekcje — audyt 2, E-26)
 * zapisane jako wydarzenia cykliczne z tą osobą jako uczestnikiem. Ekran otwiera się z obecnym planem, zapis zmienia go
 * od jutra (D128, M-14). Który tydzień jest A, pamięta się przy osobie (D171). Pojedynczą lekcję nadal zmienia się jak
 * zwykłe wydarzenie. Logika: domain/views/timetable.ts.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import { DraftNote, useFormDraft } from '../../app/form-draft';
import type { RootStackParams } from '../../app/routes';
import { WEEKDAYS_NOMINATIVE } from '../../config/calendar.pl';
import { addDays, isoWeekday } from '../../domain/civil-date';
import { formatRange } from '../../domain/format';
import { materialize } from '../../domain/sync-engine/client';
import { groupDetail } from '../../domain/views';
import type { SeriesEffects } from '../../domain/views/event-tasks';
import { type Lesson, type LostChoice, memberTimetable, swapWeeks, timetableOps, type Week } from '../../domain/views/timetable';
import { SeriesPreview } from '../events/SeriesPreview';
import { strings } from '../../i18n/strings.pl';
import { useUndo } from '../../ui/undo';
import { BackButton, Body, Button, Card, ErrorText, Field, MissingScreen, Screen, SectionTitle, Segmented, Title, useFormError } from '../../ui/components';
import { TimeFieldPair } from '../../ui/TimeField';
import { DateField } from '../../ui/DateField';
import { useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<RootStackParams, 'Timetable'>;
const SCHOOL_DAYS = [0, 1, 2, 3, 4];
const WEEKEND = [5, 6];
const cap = (s: string) => s.charAt(0).toLocaleUpperCase('pl') + s.slice(1);

export function TimetableScreen({ route, navigation }: Props) {
  const { userId, store, newId } = useServices();
  const { tables, today } = useAppData();
  const { c } = useTheme();
  const undo = useUndo();
  const d = groupDetail(tables, userId, route.params.groupId);
  const m = d?.members.find((x) => x.member_id === route.params.memberId);
  // D128: obecny plan (stan z chwili otwarcia — zapis kończy dokładnie te serie).
  const [plan] = useState(() => memberTimetable(tables, route.params.groupId, route.params.memberId, today));
  const [lessons, setLessons] = useState<Lesson[]>(plan.lessons);
  const [thisWeek, setThisWeek] = useState<'A' | 'B'>(plan.thisWeek);
  const [until, setUntil] = useState(plan.until);
  const [error, setError, attempt] = useFormError<{ text: string; index: number }>();
  const [preview, setPreview] = useState<SeriesEffects | null>(null);
  const [lostChoice, setLostChoice] = useState<LostChoice>('nearest');
  // D179 (audyt 2, M-123): szkic na telefonie — wyjście bez „Zapisz” zostawia wpisany plan (app/form-draft); nakłada się
  // na plan z chwili ponownego otwarcia tylko w polach, które zmieniłem.
  const draft = useFormDraft(`timetable:${route.params.groupId}:${route.params.memberId}`, { lessons, thisWeek, until }, { lessons: setLessons, thisWeek: setThisWeek, until: setUntil });

  if (!d || !m || d.group.me.role === 'child') {
    return (
      <MissingScreen testID="screen-timetable-missing" text={strings['groups.error.member']} onBack={() => navigation.goBack()} />
    );
  }
  const monday = addDays(today, -isoWeekday(today));
  // Audyt 2 (E-26): sobota i niedziela, gdy mają lekcje (np. lekcja przeniesiona na sobotę „to i następne”).
  const days = [...SCHOOL_DAYS, ...WEEKEND.filter((x) => lessons.some((l) => l.day === x))];
  // Numer lekcji w obrębie jej dnia (jak w etykietach VoiceOvera, M-145).
  const lessonNo = (i: number) => lessons.slice(0, i + 1).filter((x) => x.day === lessons[i]!.day).length;
  const set = (i: number, patch: Partial<Lesson>) => (setLessons((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))), setError(null));
  const add = (day: number) => {
    const prev = [...lessons].reverse().find((l) => l.day === day);
    setLessons([...lessons, { day, title: '', start: prev?.end ?? '08:00', end: '', week: 'both' }]);
  };
  // `choice` — po podglądzie (audyt 2, M-14): co z zadaniami z terminów, których po zmianie nie będzie.
  const save = (choice?: LostChoice) => {
    const edit = plan.series.length ? { tables, userId, series: plan.series } : undefined;
    const r = timetableOps({ groupId: d.group.id, memberId: m.member_id, lessons, thisWeek, today, until: until || null, newId, edit, keepUntil: until === plan.until, weekA: plan.weekA, lost: choice });
    // Błąd daty końca dotyczy pola „Do dnia”, nie lekcji (stoi pod nim).
    if ('error' in r) return setError({ text: r.error === 'empty' ? strings['timetable.empty'] : r.error === 'title' ? strings['timetable.error.title'] : strings[`event.error.${r.error}`], index: r.error === 'until' ? -1 : r.index });
    // Bez zmian (audyt 2, E-5): nic do zapisu ani cofania.
    if (r.ops.length === 0) return (draft.saved(), navigation.goBack());
    // Zapis zmienia zadania albo zmienione pojedynczo terminy — najpierw ten sam podgląd co przy „to i następne”.
    // Szkic zostaje do zapisu: „Wróć” z podglądu i wyjście z ekranu go nie gubią (D179).
    if (!choice && (r.effects.lost.length || r.effects.overridesLost)) return setPreview(r.effects);
    draft.saved();
    store.dispatch(r.ops);
    // Cofnięcie: nowe serie do kosza, stary plan wraca — liczone w chwili cofnięcia (kopie stałych zadań z międzyczasu).
    undo.show(plan.series.length ? strings['timetable.updated'] : strings['timetable.saved'](r.series), () => store.dispatch(r.undo(materialize(store.getSnapshot().state))), { lost: 'plan' });
    navigation.goBack();
  };

  if (preview) {
    return <SeriesPreview testID="screen-timetable-preview" saveTestID="timetable-preview-save" effects={preview} today={today} choice={lostChoice} onChoice={setLostChoice} onSave={() => save(lostChoice)} onBack={() => setPreview(null)} />;
  }

  return (
    <Screen testID="screen-timetable">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings['timetable.title'](m.display_name)}</Title>
      <DraftNote draft={draft} />
      <Body muted>{strings['timetable.info']}</Body>
      <Segmented
        label={strings['timetable.thisWeek'](formatRange(monday, addDays(monday, 6), today))}
        value={thisWeek}
        // D171: zmiana nazwy tygodnia nie przesuwa lekcji — litery lekcji zamieniają się razem z nią.
        onChange={(w) => {
          if (w === thisWeek) return;
          setThisWeek(w);
          setLessons(swapWeeks);
        }}
        options={[
          { value: 'A', label: strings['timetable.weekA'] },
          { value: 'B', label: strings['timetable.weekB'] },
        ]}
      />
      <Body muted>{strings['timetable.thisWeekInfo']}</Body>
      {days.map((day) => (
        <View key={day} style={{ gap: 10 }} testID={`timetable-day-${day}`}>
          <SectionTitle>{cap(WEEKDAYS_NOMINATIVE[day]!)}</SectionTitle>
          {lessons.map((l, i) => {
            if (l.day !== day) return null;
            // Audyt 2 (M-145): numer w obrębie dnia i dzień w etykietach VoiceOvera.
            const n = lessonNo(i);
            const wd = WEEKDAYS_NOMINATIVE[day]!;
            const a11y = (field: string) => strings['timetable.fieldA11y'](field, n, wd);
            return (
              <Card kind="panel" key={i} style={{ borderColor: error?.index === i ? c.danger : c.border }}>
                <Field label={strings['timetable.lesson']} accessibilityLabel={strings['timetable.lessonA11y'](n, wd)} value={l.title} onChangeText={(title) => set(i, { title })} testID={`lesson-title-${i}`} />
                <TimeFieldPair
                  start={{ label: strings['event.start'], a11yLabel: a11y(strings['event.start']), value: l.start, onChange: (start) => set(i, { start }), testID: `lesson-start-${i}` }}
                  end={{ label: strings['timetable.end'], a11yLabel: a11y(strings['timetable.end']), value: l.end, onChange: (end) => set(i, { end }), testID: `lesson-end-${i}` }}
                />
                <Segmented
                  label={strings['timetable.week']}
                  a11yLabel={a11y(strings['timetable.week'])}
                  // Audyt 3 (N-196): te same opcje co przełącznik „Ten tydzień to…” — opcja mówi, której lekcji dotyczy.
                  contextual
                  value={l.week}
                  onChange={(week: Week) => set(i, { week })}
                  options={[
                    { value: 'both', label: strings['timetable.both'] },
                    { value: 'A', label: strings['timetable.weekA'] },
                    { value: 'B', label: strings['timetable.weekB'] },
                  ]}
                />
                {/* Audyt 2 (M-39, A-21): błąd przy lekcji tekstem, nie tylko czerwoną ramką; ogłasza go napis przy „Zapisz”. */}
                {error?.index === i ? <ErrorText silent>{error.text}</ErrorText> : null}
                <Button kind="danger" label={strings['timetable.remove']} a11yLabel={strings['timetable.removeA11y'](n, wd)} onPress={() => (setLessons(lessons.filter((_, j) => j !== i)), setError(null))} />
              </Card>
            );
          })}
          <Button kind="secondary" label={strings['timetable.add'](WEEKDAYS_NOMINATIVE[day]!)} testID={`lesson-add-${day}`} onPress={() => add(day)} />
        </View>
      ))}
      <DateField label={strings['timetable.until']} value={until} onChange={setUntil} today={today} testID="timetable-until" optional />
      {error ? <ErrorText attempt={attempt}>{error.index >= 0 ? strings['timetable.fixLesson'](lessonNo(error.index), WEEKDAYS_NOMINATIVE[lessons[error.index]!.day]!, error.text) : error.text}</ErrorText> : null}
      <Button label={strings['timetable.save']} onPress={() => save()} testID="timetable-save" />
    </Screen>
  );
}
