/** Wydarzenie z kalendarza iPhone'a (D95): tylko do podglądu — zmienia się je w aplikacji Kalendarz. */
import { Text, View } from 'react-native';

import type { DeviceEntry } from '../../domain/views/calendar-sync';
import { strings } from '../../i18n/strings.pl';
import { useTheme } from '../../ui/theme';

export function DeviceEventRow({ e }: { e: DeviceEntry }) {
  const { c, font, size } = useTheme();
  const when = e.continued ? strings['device.continued'] : e.time ? (e.endTime ? `${e.time}–${e.endTime}` : e.time) : strings['device.allDay'];
  return (
    // D108: jak wiersz wydarzenia grupy (EventRow), ale wyciszony — szary znacznik zamiast koloru grupy.
    <View testID={`device-${e.key}`} accessible accessibilityLabel={`${e.title}, ${when}, ${strings['device.from'](e.calendarTitle)}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 60 }}>
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
  );
}
