/**
 * Przypomnienia na telefonie (D75, ADR 0016): ustawienia (osobno dla konta, D175), zgoda iOS na powiadomienia
 * i planowanie powiadomień lokalnych z bieżących danych. Plan odświeża się po każdej zmianie danych, ustawień albo
 * zgody (z krótkim opóźnieniem, żeby seria zmian z synchronizacji dała jedno przeplanowanie). Bez zgody — nic.
 * Audyt 2: zgoda udzielona w aplikacji od razu planuje (N-10), a zmiana w Ustawieniach iPhone'a jest widoczna po
 * powrocie do aplikacji (N-10, N-21); po odmowie Ustawienia aplikacji prowadzą do Ustawień iPhone'a (N-8).
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { config } from '../config';
import { type CivilDate, formatIsoDate } from '../domain/civil-date';
import type { Tables } from '../domain/views/model';
import { planReminders, type Reminder, type ReminderSettings } from '../domain/views/reminders';
import { strings } from '../i18n/strings.pl';
import { localNow, localToMs } from './clock';
import { useAppData, useServices } from './context';
import { useMyScope } from './my-scope';
import { type ScopeOf, scopeAll } from '../domain/views/my-scope';
import { appVersion, toClientError } from './diagnostics';
import { REMINDER_SETTINGS } from './account-prefs';
import { type PushStatus, registerIfAllowed } from './push';
import { type TravelInfo, useTravel } from './travel';

const DEFAULTS: ReminderSettings = { leadMin: config.reminders.LEAD_MIN, morning: config.reminders.MORNING, leave: config.reminders.LEAVE };
const DEBOUNCE_MS = 1500;

/** Zapisane ustawienia przypomnień; uszkodzone albo niepełne — null (domyślne). */
export function parseReminderSettings(raw: string | null): ReminderSettings | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ReminderSettings>;
    // `leave` od PWD-17 — zapis sprzed niego go nie ma (= włączone).
    return typeof v.leadMin === 'number' && typeof v.morning === 'string' ? { leadMin: v.leadMin, morning: v.morning, ...(typeof v.leave === 'boolean' ? { leave: v.leave } : {}) } : null;
  } catch {
    return null;
  }
}

/**
 * Plan przypomnień z danych telefonu — jedno wejście bez Reacta (dostawca niżej; także przyszłe planowanie w tle,
 * PW-22). `travel` — policzony dojazd do wystąpienia albo null.
 */
export function reminderPlan(tables: Tables, userId: string, today: CivilDate, nowMs: number, settings: ReminderSettings, travel: (eventId: string, occurrenceDate: string) => TravelInfo | null, scopeOf: ScopeOf = scopeAll): Reminder[] {
  return planReminders(tables, userId, today, nowMs, settings, {
    days: config.reminders.DAYS_AHEAD,
    max: config.reminders.MAX_SCHEDULED,
    toMs: localToMs,
    localDate: (iso) => formatIsoDate(localNow(Date.parse(iso))),
    label: { trip: strings['trip.title'], morningTitle: strings['reminders.morningTitle'], more: strings['reminders.more'], summary: strings['reminders.summary'], leave: strings['travel.leaveTitle'], late: strings['travel.lateBody'], subtasks: strings['reminders.subtasks'], parent: strings['nest.parent'], who: strings['who.task'] },
    // D117: wydarzenie z policzonym dojazdem — „Czas wyjść” o godzinie wyjścia.
    leaveFor: (id, occ) => {
      const i = travel(id, occ);
      return i ? { at: i.leaveMs, body: strings['travel.leaveBody'](i.minutes, strings[`travel.mode.${i.mode}`]) } : null;
    },
    scopeOf,
  });
}

type Api = {
  settings: ReminderSettings;
  setSettings: (s: ReminderSettings) => void;
  available: boolean;
  /** Zgoda iOS na powiadomienia; null — jeszcze nie odczytana. */
  status: PushStatus | null;
  /** Okno systemowe z prośbą o zgodę; po zgodzie rejestracja tokenu i plan od razu. */
  enable: () => Promise<void>;
  /** Ustawienia iPhone'a → Organizer: po odmowie tylko tam da się włączyć powiadomienia. */
  openSettings: () => void;
};
const Ctx = createContext<Api>({ settings: DEFAULTS, setSettings: () => {}, available: false, status: null, enable: async () => {}, openSettings: () => {} });
export const useReminderSettings = () => useContext(Ctx);

export function RemindersProvider({ children }: { children: ReactNode }) {
  const { push, prefs, account, userId, nowMs } = useServices();
  const { tables, today } = useAppData();
  const travel = useTravel();
  const { scopeOf } = useMyScope();
  const [settings, setState] = useState<ReminderSettings>(DEFAULTS);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<PushStatus | null>(null);
  useEffect(() => {
    let live = true;
    prefs
      ?.get(REMINDER_SETTINGS)
      .then((raw) => {
        const s = parseReminderSettings(raw);
        if (live && s) setState({ ...DEFAULTS, ...s });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [prefs]);
  // Zgoda: przy starcie i po każdym powrocie do aplikacji (mogła się zmienić w Ustawieniach iPhone'a).
  useEffect(() => {
    if (!push) return;
    let live = true;
    const read = () =>
      void push
        .status()
        .then((s) => live && setStatus(s))
        .catch(() => {});
    read();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && read());
    return () => {
      live = false;
      sub.remove();
    };
  }, [push]);
  // Błąd planowania powtarza się przy każdej zmianie danych — jedno zgłoszenie na uruchomienie (jak kalendarz).
  const reported = useRef(false);
  useEffect(() => {
    if (!push || status !== 'granted') return;
    const timer = setTimeout(() => {
      push.replaceReminders(reminderPlan(tables, userId, today, nowMs(), settings, travel.info, scopeOf)).catch((e: unknown) => {
        if (reported.current) return;
        reported.current = true;
        account.reportError(toClientError(e, 'error', 'reminders', appVersion())).catch(() => {});
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [push, account, status, tables, userId, today, nowMs, settings, version, travel, scopeOf]);
  const enable = useCallback(async () => {
    if (!push) return;
    const ok = await push.request().catch(() => false);
    if (ok) await registerIfAllowed(push, (t, e) => account.registerPushToken(t, e));
    await push
      .status()
      .then(setStatus)
      .catch(() => {});
  }, [push, account]);
  const api = useMemo<Api>(
    () => ({
      settings,
      available: !!push,
      status,
      enable,
      openSettings: () => void Linking.openSettings().catch(() => {}),
      setSettings: (s) => {
        setState(s);
        setVersion((v) => v + 1);
        prefs?.set(REMINDER_SETTINGS, JSON.stringify(s)).catch(() => {});
      },
    }),
    [settings, push, prefs, status, enable],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
