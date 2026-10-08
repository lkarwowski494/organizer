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
import { strings } from '../../i18n/strings.pl';
import { useTheme } from '../../ui/theme';

/** Parametry formularza wydarzenia z wpisu iPhone'a (koniec „24:00” — wydarzenie trwa dłużej niż do północy: bez końca). */
export const copyParams = (e: DeviceEntry): RootStackParams['EventEdit'] => ({
  title: e.title,
  date: e.date,
  ...(e.time ? { start: e.time, ...(e.endTime && e.endTime !== '24:00' ? { end: e.endTime } : {}) } : { allDay: true }),
  ...(e.location ? { location: e.location } : {}),
  fromDevice: true,
});

export function DeviceEventRow({ e, copy = true }: { e: DeviceEntry; copy?: boolean }) {
  const { c, font, size } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const when = e.continued ? strings['device.continued'] : e.time ? (e.endTime ? `${e.time}–${e.endTime}` : e.time) : strings['device.allDay'];
  return (
    // D108: jak wiersz wydarzenia grupy (EventRow), ale wyciszony — szary znacznik zamiast koloru grupy.
    <View testID={`device-${e.key}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 60 }}>
      <View accessible accessibilityLabel={`${e.title}, ${when}, ${strings['device.from'](e.calendarTitle)}`} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 30, alignItems: 'center' }}>
          <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: c.control }} />
        </View>
        <View style={{ flex: 1, paddingVertical: 10, gap: 3 }}>
          <Text style={{ fontFamily: font.text600, fontSize: size.BODY, lineHeight: size.BODY * 1.25, color: c.inkMuted }}>{e.title}</Text>
          <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>
            <Text style={{ fontFamily: font.text700, color: c.ink }}>{when}</Text>
            {`  ·  ${strings['device.from'](e.calendarTitle)}`}
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
