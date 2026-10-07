/** Historia zadania (D76): kto, co, kiedy — najnowsze na górze. */
import { Text, View } from 'react-native';

import { localNow } from '../../app/clock';
import type { CivilDate } from '../../domain/civil-date';
import { formatLongDate } from '../../domain/format';
import type { HistoryEntry } from '../../domain/views/history';
import { strings } from '../../i18n/strings.pl';
import { Body, SectionTitle } from '../../ui/components';
import { useTheme } from '../../ui/theme';

const FIELDS = new Set(['title', 'note', 'assignee_member_id', 'due_date', 'repeat', 'rollover', 'list_id', 'start_date']);

export function describe(e: HistoryEntry): string {
  if (e.verb !== 'update') return strings[`history.${e.verb}`];
  const names = [...new Set(e.fields.map((f) => (FIELDS.has(f) ? strings[`history.field.${f}` as 'history.field.title'] : strings['history.field.other'])))];
  return strings['history.update'](names.join(', '));
}

export function TaskHistory({ entries, today }: { entries: HistoryEntry[]; today: CivilDate }) {
  const { c, font, size } = useTheme();
  return (
    <View testID="task-history" style={{ gap: 6 }}>
      <SectionTitle>{strings['history.title']}</SectionTitle>
      {entries.length === 0 ? <Body muted>{strings['history.empty']}</Body> : null}
      {entries.map((e) => {
        const l = localNow(Date.parse(e.at));
        const when = `${formatLongDate(l, today)}, ${String(l.hh).padStart(2, '0')}:${String(l.mm).padStart(2, '0')}`;
        return (
          <Text key={e.id} style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>
            <Text style={{ fontFamily: font.text700, color: c.ink }}>{e.who ?? strings['history.someone']}</Text>
            {` ${describe(e)} · ${when}`}
          </Text>
        );
      })}
    </View>
  );
}
