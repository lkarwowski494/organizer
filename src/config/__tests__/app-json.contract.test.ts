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
    for (const key of ['NSCalendarsUsageDescription', 'NSCalendarsWriteOnlyAccessUsageDescription', 'NSRemindersUsageDescription', 'NSRemindersFullAccessUsageDescription']) {
      expect(String(plist[key])).toMatch(/^Organizer /);
    }
  }, 60000);
});
