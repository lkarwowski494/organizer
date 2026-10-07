/**
 * Wydarzenie (jedno wystąpienie): kiedy, gdzie w serii, kogo dotyczy. Zmiana i odwołanie w zakresie
 * „tylko to / to i następne / wszystkie” (D57); jednorazowe — po prostu zmiana albo usunięcie.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { formatLongDate, parseIsoDate } from '../../domain/format';
import { cancelEvent, describeRule, eventDetail, fieldsOf, type Scope, timeLabel } from '../../domain/views/events';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, Screen, SectionTitle, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<RootStackParams, 'Event'>;

const SCOPES: Scope[] = ['this', 'following', 'all'];

export function EventScreen({ route, navigation }: Props) {
  const { userId, store, newId } = useServices();
  const { tables, today } = useAppData();
  const { c, font, line } = useTheme();
  const { eventId, date } = route.params;
  const d = useMemo(() => eventDetail(tables, userId, eventId), [tables, userId, eventId]);
  const [ask, setAsk] = useState<'edit' | 'cancel' | 'delete' | null>(null);

  if (!d || d.event.deleted_at !== null) {
    return (
      <Screen testID="screen-event-missing">
        <BackButton onPress={() => navigation.goBack()} />
        <Body muted>{strings['common.error']}</Body>
      </Screen>
    );
  }
  const occ = fieldsOf(d, date, 'this');
  const recurring = d.rule !== null;
  const time = timeLabel(occ.startTime, occ.endTime) ?? strings['event.allDayLabel'];
  const names = d.members.filter((m) => occ.participantIds.includes(m.member_id)).map((m) => m.display_name);
  const edit = (scope: Scope) => navigation.navigate('EventEdit', { eventId, date, scope });
  const cancel = (scope: Scope) => {
    store.dispatch(cancelEvent(d, date, scope, newId));
    navigation.goBack();
  };

  return (
    <Screen testID="screen-event">
      <BackButton onPress={() => navigation.goBack()} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 20, height: 20, borderRadius: 5, backgroundColor: line(d.line).line }} />
        <Text style={{ fontFamily: font.text700, fontSize: 15, color: line(d.line).ink }}>{d.groupName}</Text>
      </View>
      <Title>{occ.title}</Title>
      <Body>{`${formatLongDate(parseIsoDate(occ.date), today)} · ${time}`}</Body>
      {occ.date !== date ? <Body muted>{strings['event.moved'](formatLongDate(parseIsoDate(date), today))}</Body> : null}
      <Body muted>{d.rule ? describeRule(d.rule, parseIsoDate(d.event.start_date)) : strings['event.oneOff']}</Body>
      <SectionTitle>{strings['event.who']}</SectionTitle>
      <Body>{d.event.audience === 'group' ? strings['event.whoAll'] : names.join(', ')}</Body>

      {!d.canEdit ? (
        <Body muted>{strings['event.readOnly']}</Body>
      ) : ask === 'edit' || ask === 'cancel' ? (
        <View style={{ gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
          <Text accessibilityRole="header" style={{ fontFamily: font.text700, fontSize: 17, color: c.ink }}>
            {ask === 'edit' ? strings['event.scopeQuestionEdit'] : strings['event.scopeQuestionCancel']}
          </Text>
          {SCOPES.map((s) => (
            <Button key={s} kind={ask === 'cancel' ? 'danger' : 'secondary'} label={strings[`event.scope.${s}`]} testID={`scope-${s}`} onPress={() => (ask === 'edit' ? edit(s) : cancel(s))} />
          ))}
          <Button kind="secondary" label={strings['common.cancel']} onPress={() => setAsk(null)} />
        </View>
      ) : ask === 'delete' ? (
        <View style={{ gap: 8 }}>
          <Body>{strings['event.deleteConfirm']}</Body>
          <Button kind="danger" label={strings['event.delete']} testID="event-delete-confirm" onPress={() => cancel('all')} />
          <Button kind="secondary" label={strings['common.cancel']} onPress={() => setAsk(null)} />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Button label={strings['event.change']} testID="event-edit" onPress={() => (recurring ? setAsk('edit') : edit('all'))} />
          <Button kind="danger" label={recurring ? strings['event.cancel'] : strings['event.delete']} testID="event-cancel" onPress={() => setAsk(recurring ? 'cancel' : 'delete')} />
        </View>
      )}
    </Screen>
  );
}
