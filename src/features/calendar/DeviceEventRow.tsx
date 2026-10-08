/** Wydarzenie z kalendarza iPhone'a (D95): tylko do podglądu — zmienia się je w aplikacji Kalendarz. */
import { Text, View } from 'react-native';

import type { DeviceEntry } from '../../domain/views/calendar-sync';
import { strings } from '../../i18n/strings.pl';
import { useTheme } from '../../ui/theme';

export function DeviceEventRow({ e }: { e: DeviceEntry }) {
  const { c, font, size } = useTheme();
  const when = e.continued ? strings['device.continued'] : e.time ? (e.endTime ? `${e.time}–${e.endTime}` : e.time) : strings['device.allDay'];
  return (
    <View testID={`device-${e.key}`} accessible accessibilityLabel={`${e.title}, ${when}, ${strings['device.from'](e.calendarTitle)}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 8 }}>
      <View style={{ width: 30, alignItems: 'center' }}>
        <View style={{ width: 14, height: 14, borderRadius: 4, borderWidth: 2, borderColor: c.inkMuted }} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: font.text600, fontSize: size.BODY, color: c.ink }}>{e.title}</Text>
        <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{`${when}  ·  ${strings['device.from'](e.calendarTitle)}`}</Text>
      </View>
    </View>
  );
}
