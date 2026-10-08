/** Wybór spotkania (wystąpienia) — do przepinania i podpinania zadań (D13, D14). Wiersz wybiera od razu, więc bez „›”. */
import { Text, View } from 'react-native';

import type { CivilDate } from '../../domain/civil-date';
import { formatDue } from '../../domain/format';
import { type Occurrence, timeLabel } from '../../domain/views/events';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, NavRow } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function OccurrencePicker({ items, today, onPick, onCancel }: { items: Occurrence[]; today: CivilDate; onPick: (o: Occurrence) => void; onCancel: () => void }) {
  const { c, font } = useTheme();
  return (
    <View style={{ gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
      <Text accessibilityRole="header" style={{ fontFamily: font.text700, fontSize: 17, color: c.ink }}>
        {strings['event.pickTitle']}
      </Text>
      {items.length === 0 ? <Body muted>{strings['event.pickEmpty']}</Body> : null}
      {items.map((o) => (
        <NavRow
          key={`${o.eventId}-${o.occurrenceDate}`}
          testID={`pick-${o.eventId}-${o.occurrenceDate}`}
          title={o.title}
          subtitle={[formatDue({ date: o.date, time: null }, today), timeLabel(o.startTime, o.endTime)].filter(Boolean).join(' · ')}
          line={o.line}
          onPress={() => onPick(o)}
          chevron={false}
        />
      ))}
      <Button kind="secondary" label={strings['common.cancel']} onPress={onCancel} />
    </View>
  );
}
