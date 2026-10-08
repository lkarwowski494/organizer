/**
 * Plan lekcji osoby z tygodniami A/B (D112, ADR 0027): lekcje pon.–pt. zapisane jako wydarzenia cykliczne z tą osobą
 * jako uczestnikiem. Ekran otwiera się z obecnym planem, zapis go zastępuje od dziś (D128). Pojedynczą lekcję nadal
 * zmienia się jak zwykłe wydarzenie. Logika: domain/views/timetable.ts.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { WEEKDAYS_NOMINATIVE } from '../../config/calendar.pl';
import { addDays, isoWeekday } from '../../domain/civil-date';
import { formatRange } from '../../domain/format';
import { groupDetail } from '../../domain/views';
import { type Lesson, memberTimetable, timetableOps, type Week } from '../../domain/views/timetable';
import { strings } from '../../i18n/strings.pl';
import { useUndo } from '../../ui/undo';
import { BackButton, Body, Button, Field, Screen, SectionTitle, Segmented, Title } from '../../ui/components';
import { TimeField } from '../../ui/TimeField';
import { DateField } from '../../ui/DateField';
import { useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<RootStackParams, 'Timetable'>;
const SCHOOL_DAYS = [0, 1, 2, 3, 4];
const cap = (s: string) => s.charAt(0).toLocaleUpperCase('pl') + s.slice(1);

export function TimetableScreen({ route, navigation }: Props) {
  const { userId, store, newId } = useServices();
  const { tables, today } = useAppData();
  const { c, font } = useTheme();
  const undo = useUndo();
  const d = groupDetail(tables, userId, route.params.groupId);
  const m = d?.members.find((x) => x.member_id === route.params.memberId);
  // D128: obecny plan (stan z chwili otwarcia — zapis kończy dokładnie te serie).
  const [plan] = useState(() => memberTimetable(tables, route.params.groupId, route.params.memberId, today));
  const [lessons, setLessons] = useState<Lesson[]>(plan.lessons);
  const [thisWeek, setThisWeek] = useState<'A' | 'B'>('A');
  const [until, setUntil] = useState(plan.until);
  const [error, setError] = useState<{ text: string; index: number } | null>(null);

  if (!d || !m || d.group.me.role === 'child') {
    return (
      <Screen testID="screen-timetable-missing">
        <BackButton onPress={() => navigation.goBack()} />
        <Body muted>{strings['common.error']}</Body>
      </Screen>
    );
  }
  const monday = addDays(today, -isoWeekday(today));
  const set = (i: number, patch: Partial<Lesson>) => (setLessons((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))), setError(null));
  const add = (day: number) => {
    const prev = [...lessons].reverse().find((l) => l.day === day);
    setLessons([...lessons, { day, title: '', start: prev?.end ?? '08:00', end: '', week: 'both' }]);
  };
  const save = () => {
    const r = timetableOps({ groupId: d.group.id, memberId: m.member_id, lessons, thisWeek, today, until: until || null, newId, existing: plan.series });
    if ('error' in r) return setError({ text: r.error === 'empty' ? strings['timetable.empty'] : strings[`event.error.${r.error}`], index: r.index });
    store.dispatch(r.ops);
    // Cofnięcie: nowe serie do kosza, stary plan wraca.
    undo.show(plan.series.length ? strings['timetable.updated'] : strings['timetable.saved'](r.series), () => store.dispatch(r.undo));
    navigation.goBack();
  };

  return (
    <Screen testID="screen-timetable">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings['timetable.title'](m.display_name)}</Title>
      <Body muted>{strings['timetable.info']}</Body>
      <Segmented
        label={strings['timetable.thisWeek'](formatRange(monday, addDays(monday, 6), today))}
        value={thisWeek}
        onChange={setThisWeek}
        options={[
          { value: 'A', label: strings['timetable.weekA'] },
          { value: 'B', label: strings['timetable.weekB'] },
        ]}
      />
      {SCHOOL_DAYS.map((day) => (
        <View key={day} style={{ gap: 10 }} testID={`timetable-day-${day}`}>
          <SectionTitle>{cap(WEEKDAYS_NOMINATIVE[day]!)}</SectionTitle>
          {lessons.map((l, i) =>
            l.day !== day ? null : (
              <View key={i} style={{ gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: error?.index === i ? c.danger : c.border }}>
                <Field label={strings['timetable.lesson']} value={l.title} onChangeText={(title) => set(i, { title })} testID={`lesson-title-${i}`} />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <TimeField label={strings['event.start']} value={l.start} onChange={(start) => set(i, { start })} testID={`lesson-start-${i}`} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TimeField label={strings['timetable.end']} value={l.end} onChange={(end) => set(i, { end })} testID={`lesson-end-${i}`} />
                  </View>
                </View>
                <Segmented
                  label={strings['timetable.week']}
                  value={l.week}
                  onChange={(week: Week) => set(i, { week })}
                  options={[
                    { value: 'both', label: strings['timetable.both'] },
                    { value: 'A', label: strings['timetable.weekA'] },
                    { value: 'B', label: strings['timetable.weekB'] },
                  ]}
                />
                <Button kind="secondary" label={strings['timetable.remove']} a11yLabel={strings['timetable.removeA11y'](i + 1)} onPress={() => (setLessons(lessons.filter((_, j) => j !== i)), setError(null))} />
              </View>
            ),
          )}
          <Button kind="secondary" label={strings['timetable.add'](WEEKDAYS_NOMINATIVE[day]!)} testID={`lesson-add-${day}`} onPress={() => add(day)} />
        </View>
      ))}
      <DateField label={strings['timetable.until']} value={until} onChange={setUntil} today={today} testID="timetable-until" />
      {error ? (
        <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>
          {error.text}
        </Text>
      ) : null}
      <Button label={strings['timetable.save']} onPress={save} testID="timetable-save" />
    </Screen>
  );
}
