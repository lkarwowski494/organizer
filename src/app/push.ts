/**
 * Powiadomienia push na iPhonie (D70, ADR 0015). expo-notifications SDK 57
 * (https://docs.expo.dev/versions/v57.0.0/sdk/notifications/): getPermissionsAsync / requestPermissionsAsync
 * (status: granted | denied | undetermined), getDevicePushTokenAsync — natywny token APNs (`data`, szesnastkowo).
 * Buildy z TestFlight i App Store używają produkcyjnego APNs (wtyczka: mode „production”), deweloperskie — sandbox.
 */
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

export type PushStatus = 'granted' | 'denied' | 'undetermined';

export interface DevicePush {
  status(): Promise<PushStatus>;
  /** Pyta o zgodę (okno systemowe — tylko raz; później tylko Ustawienia iPhone'a). */
  request(): Promise<boolean>;
  token(): Promise<string | null>;
  env: 'sandbox' | 'production';
  /** „Nie teraz” przy prośbie o powiadomienia — zapamiętane na telefonie. */
  dismissed(): Promise<boolean>;
  dismiss(): Promise<void>;
}

const DISMISSED = 'pushPromptDismissed';
const asStatus = (s: string): PushStatus => (s === 'granted' || s === 'denied' ? s : 'undetermined');

export const expoDevicePush: DevicePush = {
  status: async () => asStatus((await Notifications.getPermissionsAsync()).status),
  request: async () => (await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } })).granted,
  token: async () => {
    const t = await Notifications.getDevicePushTokenAsync();
    return typeof t.data === 'string' ? t.data : null;
  },
  env: __DEV__ ? 'sandbox' : 'production',
  dismissed: async () => (await SecureStore.getItemAsync(DISMISSED)) === '1',
  dismiss: () => SecureStore.setItemAsync(DISMISSED, '1'),
};

/** Zgoda jest — zarejestruj token tego telefonu (bez zgody: nic). Błędy sieci ciche: spróbujemy przy następnym starcie. */
export async function registerIfAllowed(push: DevicePush, register: (token: string, env: DevicePush['env']) => Promise<void>): Promise<boolean> {
  try {
    if ((await push.status()) !== 'granted') return false;
    const token = await push.token();
    if (!token) return false;
    await register(token, push.env);
    return true;
  } catch {
    return false;
  }
}
