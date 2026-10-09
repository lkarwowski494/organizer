/** Wybór spotkania (wystąpienia) — do przepinania i podpinania zadań (D13, D14). Wiersz wybiera od razu, więc bez „›”. */

import type { CivilDate } from '../../domain/civil-date';
import { formatDue } from '../../domain/format';
import { type Occurrence, timeLabel } from '../../domain/views/events';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, Card, CardTitle, NavRow } from '../../ui/components';

export function OccurrencePicker({ items, today, onPick, onCancel }: { items: Occurrence[]; today: CivilDate; onPick: (o: Occurrence) => void; onCancel: () => void }) {
  return (
    <Card kind="panel">
      <CardTitle>
        {strings['event.pickTitle']}
      </CardTitle>
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
    </Card>
  );
}
