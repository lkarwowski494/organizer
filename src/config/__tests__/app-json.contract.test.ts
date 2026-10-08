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
    // D96: pełny dostęp do kalendarza, ale prywatne wydarzenia zostają na telefonie — tak mówi opis.
    expect(String(plist.NSCalendarsFullAccessUsageDescription)).toContain('nie opuszczają telefonu');
    // D116: lokalizacja tylko „podczas używania” (czas dojazdu); bez „zawsze”.
    expect(String(plist.NSLocationWhenInUseUsageDescription)).toMatch(/^Organizer .*nie trafia na serwer/);
    for (const key of ['NSLocationAlwaysAndWhenInUseUsageDescription', 'NSLocationAlwaysUsageDescription']) expect(plist[key]).toBeUndefined();
    // D123: expo-location zawiera kod czujnika ruchu (CMMotionActivityManager), więc Apple wymaga opisu (ITMS-90683,
    // odrzucony build 19), choć aplikacja nigdy o tę zgodę nie pyta. Opis mówi to wprost.
    expect(String(plist.NSMotionUsageDescription)).toMatch(/^Organizer nie korzysta z czujników ruchu/);
    // Audyt 2 (N-18): aplikacja nie używa Face ID (SecureStore bez requireAuthentication), więc bez angielskiego
    // opisu domyślnego wtyczki expo-secure-store — faceIDPermission: false usuwa klucz (@expo/config-plugins).
    expect(plist.NSFaceIDUsageDescription).toBeUndefined();
  }, 60000);
});

describe('funkcja notify-handoff zgodna z src/config', () => {
  it('PUSH_MAX_AGE_H', () => {
    const src = jest.requireActual<typeof import('node:fs')>('node:fs').readFileSync(`${__dirname}/../../../supabase/functions/notify-handoff/handler.ts`, 'utf8');
    expect(src).toContain(`export const PUSH_MAX_AGE_H = ${config.PUSH_MAX_AGE_H};`);
  });

  it('wtyczka powiadomień: produkcyjne APNs (TestFlight, App Store)', () => {
    expect(appJson.expo.plugins).toContainEqual(['expo-notifications', { mode: 'production' }]);
  });
});
