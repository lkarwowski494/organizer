/**
 * Przypomnienia na telefonie (D75, ADR 0016): ustawienia (zapamiętane na telefonie) i planowanie powiadomień
 * lokalnych z bieżących danych. Plan odświeża się po każdej zmianie danych albo ustawień (z krótkim opóźnieniem,
 * żeby seria zmian z synchronizacji dała jedno przeplanowanie). Bez zgody na powiadomienia — nic.
 */
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { config } from '../config';
import { planReminders, type ReminderSettings } from '../domain/views/reminders';
import { formatIsoDate } from '../domain/civil-date';
import { strings } from '../i18n/strings.pl';
import { localNow, localToMs } from './clock';
import { useAppData, useServices } from './context';

const DEFAULTS: ReminderSettings = { leadMin: config.reminders.LEAD_MIN, morning: config.reminders.MORNING };
const DEBOUNCE_MS = 1500;

type Api = { settings: ReminderSettings; setSettings: (s: ReminderSettings) => void; available: boolean };
const Ctx = createContext<Api>({ settings: DEFAULTS, setSettings: () => {}, available: false });
export const useReminderSettings = () => useContext(Ctx);

export function RemindersProvider({ children }: { children: ReactNode }) {
  const { push, userId, nowMs } = useServices();
  const { tables, today } = useAppData();
  const [settings, setState] = useState<ReminderSettings>(DEFAULTS);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    push
      ?.reminderSettings()
      .then((s) => live && s && setState(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [push]);
  useEffect(() => {
    if (!push) return;
    const timer = setTimeout(() => {
      push
        .status()
        .then((st) => {
          if (st !== 'granted') return;
          const list = planReminders(tables, userId, today, nowMs(), settings, {
            days: config.reminders.DAYS_AHEAD,
            max: config.reminders.MAX_SCHEDULED,
            toMs: localToMs,
            localDate: (iso) => formatIsoDate(localNow(Date.parse(iso))),
            label: { trip: strings['trip.title'], morningTitle: strings['reminders.morningTitle'], more: strings['reminders.more'] },
          });
          return push.replaceReminders(list);
        })
        .catch(() => {});
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [push, tables, userId, today, nowMs, settings, version]);
  const api = useMemo<Api>(
    () => ({
      settings,
      available: !!push,
      setSettings: (s) => {
        setState(s);
        setVersion((v) => v + 1);
        push?.saveReminderSettings(s).catch(() => {});
      },
    }),
    [settings, push],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
