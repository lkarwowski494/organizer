/**
 * Napisy „kiedy” wydarzeń w wierszach (D199): wydarzenie przez północ i przez kilka dni w każdym swoim dniu —
 * „22:00–06:00 · 8 h · dzień 1 z 2”, „do 06:00 · dzień 2 z 2”, „cały dzień · dzień 3 z 5”. To samo dla wydarzeń grup
 * (EventRow) i z iPhone'a (DeviceEventRow) — zamiast dawnego „cd.” (audyt 2, M-253: niejasne, VoiceOver czytał „c d”).
 */
import { type DayPart, type DayWhen, dayWhen } from '../domain/span';
import { lengthLabel } from '../domain/views/events';
import { strings } from '../i18n/strings.pl';

/** Godziny dnia; `null` — cały dzień (wiersz pokazuje wtedy swoje „cały dzień”). */
export function whenText(w: DayWhen): string | null {
  switch (w.kind) {
    case 'allDay':
      return null;
    case 'time':
      return w.end === null ? w.start : `${w.start}–${w.end}`;
    case 'from':
      return strings['event.from'](w.start);
    case 'until':
      return strings['event.to'](w.end);
  }
}

export const partText = (p: DayPart | null) => (p === null ? null : strings['event.dayOf'](p.day, p.days));

/** Pola wiersza wydarzenia: kiedy, długość (tylko przy godzinach od–do) i który to dzień wielodniowego. */
export function occurrenceRow(o: { startTime: string | null; endTime: string | null; part: DayPart | null }): { time: string | null; length: string | null; part: string | null } {
  const w = dayWhen(o.startTime, o.endTime, o.part);
  return { time: whenText(w), length: w.kind === 'time' ? lengthLabel(o.startTime, o.endTime) : null, part: partText(o.part) };
}
