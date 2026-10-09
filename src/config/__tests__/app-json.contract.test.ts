/**
 * Test kontraktowy: identyfikatory w app.json (czytanym przez Expo przy buildzie) muszą być
 * zgodne z src/config — jedynym źródłem prawdy w kodzie aplikacji.
 */
import appJson from '../../../app.json';
import { config } from '../index';

describe('app.json zgodny z src/config', () => {
  const { expo } = appJson;

  it('bundle ID (D36)', () => {
    expect(expo.ios.bundleIdentifier).toBe(config.BUNDLE_ID);
  });

  it('app group (D17, D36)', () => {
    expect(expo.ios.entitlements['com.apple.security.application-groups']).toEqual([config.APP_GROUP]);
  });

  it('schemat linków głębokich (D40)', () => {
    expect(expo.scheme).toBe(config.URL_SCHEME);
  });

  it('najniższy iOS (D35) = config.IOS_MIN = minimum Expo SDK 57', () => {
    expect(expo.ios.deploymentTarget).toBe(config.IOS_MIN);
    // Po zmianie SDK: minimum z podspeca Expo musi się zgadzać (inaczej D35 i config są nieaktualne).
    const { readFileSync } = jest.requireActual<typeof import('fs')>('fs');
    const podspec = readFileSync(require.resolve('expo/Expo.podspec'), 'utf8');
    expect(/:ios => '([\d.]+)'/.exec(podspec)?.[1]).toBe(config.IOS_MIN);
  });
});

/**
 * Opisy uprawnień w Info.plist (ITMS-90683, odrzucone buildy 3–6): Apple wymaga NSCalendarsUsageDescription, bo
 * expo-calendar odwołuje się do API pełnego dostępu, nawet gdy prosimy tylko o zapis. Sprawdzamy wynik prebuildu
 * (te same wtyczki co w buildzie), nie samo app.json.
 */
describe('Info.plist po wtyczkach', () => {
  it('ma polskie opisy kalendarza i przypomnień', async () => {
    const { getPrebuildConfigAsync } = jest.requireActual<typeof import('@expo/prebuild-config')>('@expo/prebuild-config');
    const { compileModsAsync } = jest.requireActual<typeof import('expo/config-plugins')>('expo/config-plugins');
    const root = `${__dirname}/../../..`;
    const { exp } = await getPrebuildConfigAsync(root, { platforms: ['ios'] });
    const out = await compileModsAsync(exp, { projectRoot: root, introspect: true, platforms: ['ios'], assertMissingModProviders: false });
    const plist = out.ios?.infoPlist ?? {};
    for (const key of ['NSCalendarsUsageDescription', 'NSCalendarsFullAccessUsageDescription', 'NSCalendarsWriteOnlyAccessUsageDescription', 'NSRemindersUsageDescription', 'NSRemindersFullAccessUsageDescription']) {
      expect(String(plist[key])).toMatch(/^Organizer /);
    }
    // D96: pełny dostęp do kalendarza; prywatne wydarzenia nie trafiają na serwer, a wydarzenia grup idą do kalendarza
    // iPhone'a (zwykle iCloud) — audyt 2 (D-19): opis mówi oba fakty.
    expect(String(plist.NSCalendarsFullAccessUsageDescription)).toMatch(/nie trafiają na serwer Organizera.*wydarzenia grup zapisujemy w Twoim kalendarzu/);
    // Audyt 2 (N-19): zgoda „tylko zapis” nie twierdzi, że aplikacja nigdy nie czyta kalendarza (pełny dostęp czyta, D95).
    expect(String(plist.NSCalendarsWriteOnlyAccessUsageDescription)).toContain('Ta zgoda nie daje dostępu do Twoich wpisów');
    // D116: lokalizacja tylko „podczas używania” (czas dojazdu); bez „zawsze”.
    expect(String(plist.NSLocationWhenInUseUsageDescription)).toMatch(/^Organizer .*nie trafia na serwer/);
    for (const key of ['NSLocationAlwaysAndWhenInUseUsageDescription', 'NSLocationAlwaysUsageDescription']) expect(plist[key]).toBeUndefined();
    // D123: expo-location zawiera kod czujnika ruchu (CMMotionActivityManager), więc Apple wymaga opisu (ITMS-90683,
    // odrzucony build 19), choć aplikacja nigdy o tę zgodę nie pyta. Opis mówi to wprost.
    expect(String(plist.NSMotionUsageDescription)).toMatch(/^Organizer nie korzysta z czujników ruchu/);
    // Audyt 2 (N-18): aplikacja nie używa Face ID (SecureStore bez requireAuthentication), więc bez angielskiego
    // opisu domyślnego wtyczki expo-secure-store — faceIDPermission: false usuwa klucz (@expo/config-plugins).
    expect(plist.NSFaceIDUsageDescription).toBeUndefined();
    // D159: ciche powiadomienia budzą aplikację w tle (Apple: Background Modes → Remote notification).
    expect(plist.UIBackgroundModes).toEqual(['remote-notification']);
  }, 60000);
});

describe('funkcja notify-handoff zgodna z src/config', () => {
  it('PUSH_MAX_AGE_H', () => {
    const src = jest.requireActual<typeof import('node:fs')>('node:fs').readFileSync(`${__dirname}/../../../supabase/functions/notify-handoff/handler.ts`, 'utf8');
    expect(src).toContain(`export const PUSH_MAX_AGE_H = ${config.PUSH_MAX_AGE_H};`);
  });

  it('WAKE_MAX_GROUPS (D159)', () => {
    const src = jest.requireActual<typeof import('node:fs')>('node:fs').readFileSync(`${__dirname}/../../../supabase/functions/notify-handoff/handler.ts`, 'utf8');
    expect(src).toContain(`export const WAKE_MAX_GROUPS = ${config.wake.MAX_GROUPS};`);
  });

  it('wtyczka powiadomień: produkcyjne APNs (TestFlight, App Store)', () => {
    // D159: tryb tła „Remote notification” (UIBackgroundModes: remote-notification) dla cichych powiadomień.
    expect(appJson.expo.plugins).toContainEqual(['expo-notifications', { mode: 'production', enableBackgroundRemoteNotifications: true }]);
  });
});
