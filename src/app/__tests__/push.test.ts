import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import { expoDevicePush, registerIfAllowed } from '../push';
import { fakePush } from './harness';

jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(), getDevicePushTokenAsync: jest.fn() }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(async () => {}) }));
const m = Notifications as jest.Mocked<typeof Notifications>;
const ss = SecureStore as jest.Mocked<typeof SecureStore>;

describe('powiadomienia na iPhonie (D70)', () => {
  it('stan zgody, prośba (alert i dźwięk), token APNs, „Nie teraz”', async () => {
    m.getPermissionsAsync.mockResolvedValueOnce({ status: 'granted' } as never).mockResolvedValueOnce({ status: 'denied' } as never).mockResolvedValueOnce({ status: 'whatever' } as never);
    expect([await expoDevicePush.status(), await expoDevicePush.status(), await expoDevicePush.status()]).toEqual(['granted', 'denied', 'undetermined']);
    m.requestPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
    expect(await expoDevicePush.request()).toBe(true);
    expect(m.requestPermissionsAsync).toHaveBeenCalledWith({ ios: { allowAlert: true, allowBadge: false, allowSound: true } });
    m.getDevicePushTokenAsync.mockResolvedValueOnce({ type: 'ios', data: 'ab'.repeat(32) } as never).mockResolvedValueOnce({ type: 'web', data: {} } as never);
    expect(await expoDevicePush.token()).toBe('ab'.repeat(32));
    expect(await expoDevicePush.token()).toBeNull();
    // Testy działają z __DEV__ = true, więc sandbox; build wydawniczy — production.
    expect(expoDevicePush.env).toBe('sandbox');
    ss.getItemAsync.mockResolvedValueOnce('1').mockResolvedValueOnce(null);
    expect([await expoDevicePush.dismissed(), await expoDevicePush.dismissed()]).toEqual([true, false]);
    await expoDevicePush.dismiss();
    expect(ss.setItemAsync).toHaveBeenCalledWith('pushPromptDismissed', '1');
  });

  it('rejestracja tylko ze zgodą i tokenem; błędy ciche', async () => {
    const reg = jest.fn(async () => {});
    expect(await registerIfAllowed(fakePush({ status: jest.fn(async () => 'granted' as const) }), reg)).toBe(true);
    expect(reg).toHaveBeenCalledWith('ab'.repeat(32), 'production');
    expect(await registerIfAllowed(fakePush(), reg)).toBe(false);
    expect(await registerIfAllowed(fakePush({ status: jest.fn(async () => 'granted' as const), token: jest.fn(async () => null) }), reg)).toBe(false);
    expect(await registerIfAllowed(fakePush({ status: jest.fn(async () => 'granted' as const) }), jest.fn(async () => Promise.reject(new Error('sieć'))))).toBe(false);
    expect(reg).toHaveBeenCalledTimes(1);
  });
});
