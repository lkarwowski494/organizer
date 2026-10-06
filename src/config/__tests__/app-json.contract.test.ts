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
