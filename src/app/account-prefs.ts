/**
 * Ustawienia konta na tym telefonie (decyzja właściciela 8.10.2026, D175 / audyt 2 M-165): pytanie o imię, obejrzane
 * wprowadzenie i „Co nowego”, „Nie teraz” przy prośbach o zgody, przypomnienia, kalendarz iPhone'a, dojazd — osobno dla
 * każdego konta. Trzymane w bazie konta (`organizer-<id>.db`, klucze `local:pref.*`), więc:
 * - drugie konto na tym telefonie zaczyna od zera, a po powrocie konto zastaje swoje ustawienia;
 * - znikają razem z plikiem bazy przy usunięciu konta (M-64) i przy usunięciu aplikacji — w odróżnieniu od pęku kluczy,
 *   który na iOS przeżywa usunięcie aplikacji: „data saved using expo-secure-store will persist across app
 *   uninstallations if the app is reinstalled with the same bundle ID … this is not guaranteed”
 *   (https://docs.expo.dev/versions/v57.0.0/sdk/securestore/).
 * Wygląd (motyw) zostaje wspólny dla telefonu (pęk kluczy, `appearance`), stan zgód iOS czytamy zawsze z systemu.
 * Przejście: ustawienia sprzed D175 (pęk kluczy, wspólne dla kont) dostaje raz konto, które zaloguje się pierwsze, a pęk
 * kluczy jest z nich czyszczony — następne konto ich nie dziedziczy.
 */
import { CAL_ASKED } from '../features/calendar/DeviceCalendarCard';
import { NAME_ASKED } from '../features/profile/NameScreen';
import { WHATS_NEW_SEEN } from '../features/today/WhatsNew';
import { WELCOME_SEEN } from '../features/welcome/WelcomeScreen';
import type { LocalStore } from './calendar-mirror';
import { CAL_MIRROR, CAL_READ, CAL_SKIP } from './calendar-sync';
import type { Prefs } from './context';
import { TRAVEL_MODE, TRAVEL_ON } from './travel';

/** „Nie teraz” przy prośbie o powiadomienia i ustawienia przypomnień (wcześniej w module push, pęk kluczy bez prefiksu). */
export const PUSH_DISMISSED = 'pushPromptDismissed';
export const REMINDER_SETTINGS = 'reminderSettings';

/** Ustawienie konta → dawny klucz w pęku kluczy (sprzed D175). */
export const LEGACY_KEYS: Readonly<Record<string, string>> = Object.fromEntries([
  ...[NAME_ASKED, WELCOME_SEEN, WHATS_NEW_SEEN, CAL_ASKED, CAL_READ, CAL_MIRROR, CAL_SKIP, TRAVEL_ON, TRAVEL_MODE].map((k) => [k, `pref.${k}`]),
  [PUSH_DISMISSED, PUSH_DISMISSED],
  [REMINDER_SETTINGS, REMINDER_SETTINGS],
]);

/**
 * Wycofane ustawienia: usuwane z pęku kluczy i z konta, bez przenoszenia. `navApp` — wybór aplikacji map z buildów
 * 21–22 (Mapy Apple albo inne); od ADR 0043 „Nawiguj” otwiera zawsze Mapy Apple.
 */
const RETIRED = ['navApp'];

/** Dawne ustawienia w pęku kluczy: odczyt i usunięcie. */
export type LegacyStore = { get(key: string): Promise<string | null>; remove(key: string): Promise<void> };

const KEY = (k: string) => `pref.${k}`;

/**
 * Przeniesienie dawnych ustawień do konta (raz): wartość już zapisana w koncie wygrywa. Klucz w pęku kluczy jest
 * usuwany dopiero po zapisie w bazie; błąd odczytu zostawia go na następny start.
 */
export async function adoptLegacyPrefs(legacy: LegacyStore | undefined, local: LocalStore): Promise<void> {
  for (const key of RETIRED) local.save(KEY(key), null);
  if (!legacy) return;
  for (const key of RETIRED) await legacy.remove(KEY(key)).catch(() => {});
  for (const [key, old] of Object.entries(LEGACY_KEYS)) {
    try {
      const v = await legacy.get(old);
      if (v === null) continue;
      if (local.load(KEY(key)) === null) local.save(KEY(key), v);
      await legacy.remove(old);
    } catch {
      // jak wyżej
    }
  }
}

/** Ustawienia konta: odczyty czekają na przeniesienie dawnych wartości (`ready`), żeby nikt nie zobaczył „pustych”. */
export function accountPrefs(local: LocalStore, ready: Promise<void>): Prefs {
  return {
    get: async (k) => {
      await ready;
      return local.load(KEY(k));
    },
    set: async (k, v) => {
      await ready;
      local.save(KEY(k), v);
    },
  };
}
