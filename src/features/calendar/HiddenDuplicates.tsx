/**
 * D173 (decyzja właściciela 8.10.2026, audyt 2 M-105): ukryte duble z kalendarza iPhone'a nie znikają bez śladu —
 * jeden wiersz „Ukryto 2 duble z iPhone’a” pod listą dnia; dotknięcie rozwija podgląd (jak zwinięte minione kopie
 * zadań na ekranie listy i lekcje w Moich sprawach).
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { DeviceEntry } from '../../domain/views/calendar-sync';
import { strings } from '../../i18n/strings.pl';
import { Body } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { DeviceEventRow } from './DeviceEventRow';

export function HiddenDuplicates({ entries, testID }: { entries: readonly DeviceEntry[]; testID: string }) {
  const { c, font, size } = useTheme();
  const [open, setOpen] = useState(false);
  if (!entries.length) return null;
  const title = strings['device.hidden'](entries.length);
  const meta = open ? strings['lists.runHide'] : strings['lists.runShow'];
  return (
    <View>
      <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${title}, ${meta}`} onPress={() => setOpen(!open)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60, gap: 8 }}>
        <View style={{ width: 30, alignItems: 'center' }}>
          <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: c.control }} />
        </View>
        <View style={{ flex: 1, paddingVertical: 10, gap: 3 }}>
          <Text style={{ fontFamily: font.text600, fontSize: size.BODY, lineHeight: size.BODY * 1.25, color: c.inkMuted }}>{title}</Text>
          <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{meta}</Text>
        </View>
      </Pressable>
      {open ? (
        <View testID={`${testID}-list`}>
          <Body muted>{strings['device.hiddenInfo']}</Body>
          {entries.map((e) => (
            <DeviceEventRow key={e.key} e={e} copy={false} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
