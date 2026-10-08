/** Reguły, które zapisuje formularz wydarzenia (każdy rodzaj powtarzania; PWD-37) — dla testów kontraktu z SQL. */
import { formatRule } from '../../rrule';
import { emptyForm, type EventForm, validateForm } from '../../views/event-form';

export function formEventRules(): string[] {
  const ev = (over: Partial<EventForm>) => {
    const v = validateForm({ ...emptyForm('2026-10-31'), title: 'X', slots: [{ days: [5, 6], start: '18:00', end: '' }], interval: '2', ends: 'until', until: '2027-12-31', ...over });
    if ('error' in v) throw new Error(v.error);
    return formatRule(v.fields[0]!.rule!);
  };
  return [ev({ repeat: 'daily' }), ev({ repeat: 'weekly' }), ev({ repeat: 'monthly', monthly: 'day' }), ev({ repeat: 'monthly', monthly: 'last' }), ev({ repeat: 'monthly', monthly: 'lastDay' }), ev({ repeat: 'yearly' })];
}
