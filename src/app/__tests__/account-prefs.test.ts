/** Ustawienia konta na telefonie (D175, audyt 2 M-165): w bazie konta, przejęcie dawnych z pęku kluczy. */
import { CAL_ASKED } from '../../features/calendar/DeviceCalendarCard';
import { NAME_ASKED } from '../../features/profile/NameScreen';
import { WHATS_NEW_SEEN } from '../../features/today/WhatsNew';
import { WELCOME_SEEN } from '../../features/welcome/WelcomeScreen';
import { accountPrefs, adoptLegacyPrefs, LEGACY_KEYS, PUSH_DISMISSED, REMINDER_SETTINGS } from '../account-prefs';
import { CAL_MIRROR, CAL_READ, CAL_SKIP } from '../calendar-sync';
import { NAV_APP, TRAVEL_MODE, TRAVEL_ON } from '../travel';
import { memoryLocal } from './harness';

describe('ustawienia konta (D175)', () => {
  it('obejmują wszystkie ustawienia konta, z dawnymi nazwami w pęku kluczy', () => {
    expect(LEGACY_KEYS).toEqual({
      [NAME_ASKED]: 'pref.nameAsked',
      [WELCOME_SEEN]: 'pref.welcomeSeen',
      [WHATS_NEW_SEEN]: 'pref.whatsNewBuild',
      [CAL_ASKED]: 'pref.calendarAsked',
      [CAL_READ]: 'pref.calendarRead',
      [CAL_MIRROR]: 'pref.calendarMirror',
      [CAL_SKIP]: 'pref.calendarSkip',
      [TRAVEL_ON]: 'pref.travelEnabled',
      [TRAVEL_MODE]: 'pref.travelMode',
      [NAV_APP]: 'pref.navApp',
      [PUSH_DISMISSED]: 'pushPromptDismissed',
      [REMINDER_SETTINGS]: 'reminderSettings',
    });
  });

  it('w bazie konta pod własnym prefiksem (bez kolizji ze stanem lustra „calendarMirror”); odczyt czeka na przejęcie', async () => {
    const local = memoryLocal();
    local.save('calendarMirror', '{"calendars":{}}');
    let done!: () => void;
    const prefs = accountPrefs(local, new Promise<void>((r) => (done = r)));
    const read = prefs.get(CAL_MIRROR);
    local.save('pref.calendarMirror', '1');
    done();
    expect(await read).toBe('1');
    await prefs.set(CAL_MIRROR, '0');
    expect([local.load('pref.calendarMirror'), local.load('calendarMirror')]).toEqual(['0', '{"calendars":{}}']);
  });

  it('przejęcie: kopiuje do konta i czyści pęk kluczy; zapis konta wygrywa; błąd odczytu zostawia klucz na później', async () => {
    const keychain = new Map([
      ['pref.welcomeSeen', '1'],
      ['pref.nameAsked', '1'],
      ['reminderSettings', '{"leadMin":10,"morning":"off"}'],
      ['pref.travelMode', 'walking'],
      ['pref.inne', 'x'],
      ['appearance', 'dark'],
    ]);
    const legacy = {
      get: jest.fn(async (k: string) => {
        if (k === 'pref.travelMode') throw new Error('keychain');
        return keychain.get(k) ?? null;
      }),
      remove: jest.fn(async (k: string) => void keychain.delete(k)),
    };
    const local = memoryLocal();
    local.save('pref.nameAsked', '0');
    await adoptLegacyPrefs(legacy, local);
    expect([local.load('pref.welcomeSeen'), local.load('pref.nameAsked'), local.load('pref.reminderSettings'), local.load('pref.travelMode')]).toEqual(['1', '0', '{"leadMin":10,"morning":"off"}', null]);
    // Wygląd i nieznane klucze zostają w pęku kluczy (telefon, nie konto); klucz z błędem — na następny start.
    expect([...keychain.keys()].sort()).toEqual(['appearance', 'pref.inne', 'pref.travelMode']);
    await expect(adoptLegacyPrefs(undefined, local)).resolves.toBeUndefined();
  });
});
