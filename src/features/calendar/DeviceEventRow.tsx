/**
 * Wydarzenie z kalendarza iPhone'a (D95): podgląd — zmienia się je w aplikacji Kalendarz. PWD-33 (D200, decyzja
 * właściciela 8.10.2026, audyt 2 M-302): „Dodaj do grupy” otwiera formularz nowego wydarzenia z nazwą, dniem, godzinami
 * i miejscem do poprawienia i wyborem grupy; po zapisie oryginał w iPhonie jest ukrywany jako dubel (D173).
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, Text, View } from 'react-native';

import type { RootStackParams } from '../../app/routes';
import type { DeviceEntry } from '../../domain/views/calendar-sync';
import { addDays, formatIsoDate } from '../../domain/civil-date';
import { parseIsoDate } from '../../domain/format';
import { dayWhen } from '../../domain/span';
import { strings } from '../../i18n/strings.pl';
import { lengthLabel } from '../../domain/views/events';
import { META_SEP } from '../../ui/components';
import { partText, whenText } from '../../ui/when';
import { useTheme } from '../../ui/theme';

/**
 * Parametry formularza wydarzenia z wpisu iPhone'a. D199: przez kilka dni — z ostatnim dniem („Kończy się”), z godziną
 * także z godziną końca ostatniego dnia (wyjazd pt. 18:00 – nd. 16:00). Koniec o północy — „00:00” następnego dnia.
 */
export const copyParams = (e: DeviceEntry): RootStackParams['EventEdit'] => {
  const midnight = (e.part === null ? e.endTime : e.eventEnd) === '24:00';
  const lastDay = midnight && e.part !== null ? formatIsoDate(addDays(parseIsoDate(e.lastDate), 1)) : e.lastDate;
  const timed = e.time ? { start: e.time, ...(e.endTime ? { end: midnight ? '00:00' : (e.eventEnd ?? e.endTime) } : {}), ...(e.part ? { endDate: lastDay } : {}) } : null;
  return {
    title: e.title,
    date: e.date,
    ...(timed ?? { allDay: true, ...(e.part ? { endDate: e.lastDate } : {}) }),
    ...(e.location ? { location: e.location } : {}),
    fromDevice: true,
  };
};

/** „Kiedy” wpisu: jak przy wydarzeniach grup (ui/when.ts) — dzień wielodniowego zamiast dawnego „cd.” (M-253). */
const whenOf = (e: DeviceEntry) => {
  if (e.part === null) return e.time ? (e.endTime ? `${e.time}–${e.endTime}` : e.time) : strings['common.allDay'];
  return whenText(dayWhen(e.eventStart, e.eventEnd, e.part)) ?? strings['common.allDay'];
};

export function DeviceEventRow({ e, copy = true }: { e: DeviceEntry; copy?: boolean }) {
  const { c, font, size } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const when = whenOf(e);
  const part = partText(e.part);
  // Audyt 2 (M-253): długość jak przy wydarzeniach grup (D120) — tylko jednodniowe z godziną końca.
  const length = e.part === null && e.time && e.endTime && e.endTime !== '24:00' ? lengthLabel(e.time, e.endTime) : null;
  return (
    // D108: jak wiersz wydarzenia grupy (EventRow), ale wyciszony — szary znacznik zamiast koloru grupy.
    <View testID={`device-${e.key}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 60 }}>
      <View accessible accessibilityLabel={[e.title, when, length, part, strings['device.from'](e.calendarTitle)].filter(Boolean).join(', ')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 30, alignItems: 'center' }}>
          <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: c.control }} />
        </View>
        <View style={{ flex: 1, paddingVertical: 10, gap: 3 }}>
          <Text style={{ fontFamily: font.text600, fontSize: size.BODY, lineHeight: size.BODY * 1.25, color: c.inkMuted }}>{e.title}</Text>
          <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>
            <Text style={{ fontFamily: font.text700, color: c.ink }}>{when}</Text>
            {length ? `${META_SEP}${length}` : ''}
            {part ? `${META_SEP}${part}` : ''}
            {`${META_SEP}${strings['device.from'](e.calendarTitle)}`}
          </Text>
        </View>
      </View>
      {copy && !e.continued ? (
        <Pressable
          testID={`device-copy-${e.key}`}
          accessibilityRole="button"
          accessibilityLabel={strings['device.addToGroupA11y'](e.title)}
          onPress={() => nav.navigate('EventEdit', copyParams(e))}
          style={{ minHeight: size.TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 22, borderWidth: 1, borderColor: c.control }}
        >
          <Text style={{ fontFamily: font.text700, fontSize: size.META, color: c.ink }}>{strings['device.addToGroup']}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
