/* global jest */
// Ekrany importują src/app/push.ts → expo-notifications, który w środowisku testów ostrzega o Expo Go.
// Ekrany dostają atrapę DevicePush (harness), więc moduł natywny zastępujemy pustą atrapą.
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(), getDevicePushTokenAsync: jest.fn(), cancelAllScheduledNotificationsAsync: jest.fn(), scheduleNotificationAsync: jest.fn(), SchedulableTriggerInputTypes: { DATE: 'date' } }));
// Wersja aplikacji w zgłoszeniach (D80) — w testach stała.
// D159: zadanie cichego powiadomienia (src/app/background.ts) — moduł natywny.
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '0.1.0', nativeBuildVersion: '13' }));
