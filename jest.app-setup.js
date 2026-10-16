/* global jest */
// Ekrany importują src/app/push.ts → expo-notifications, który w środowisku testów ostrzega o Expo Go.
// Ekrany dostają atrapę DevicePush (harness), więc moduł natywny zastępujemy pustą atrapą.
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(), getDevicePushTokenAsync: jest.fn(), getAllScheduledNotificationsAsync: jest.fn(async () => []), cancelScheduledNotificationAsync: jest.fn(), scheduleNotificationAsync: jest.fn(), SchedulableTriggerInputTypes: { DATE: 'date' } }));
// Wersja aplikacji w zgłoszeniach (D80) — w testach stała.
// D159: zadanie cichego powiadomienia (src/app/background.ts) — moduł natywny.
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '0.1.0', nativeBuildVersion: '13' }));
// Audyt 2 (M-293): SF Symbols (expo-symbols) to widok natywny — w testach zwykły węzeł z tymi samymi właściwościami
// (nazwa symbolu, rozmiar, kolor), żeby testy ekranów sprawdzały, jaki symbol i jak duży się rysuje.
jest.mock('expo-symbols', () => {
  const { createElement } = jest.requireActual('react');
  return { SymbolView: ({ fallback: _fallback, ...props }) => createElement('ExpoSymbolView', props) };
});
// ADR-0045: animacja przy starcie (src/ui/Intro.tsx) używa react-native-reanimated, a ten modułu natywnego worklets.
// W Jest — oficjalna atrapa biblioteki (react-native-worklets/src/mock.ts: worklety jako zwykłe funkcje w wątku JS). Atrapa
// podmienia też globalne requestAnimationFrame; przywracamy wersję z presetu React Native, żeby pozostałe testy ekranów
// działały jak dotąd.
jest.mock('react-native-worklets', () => {
  const raf = globalThis.requestAnimationFrame;
  const mock = jest.requireActual('react-native-worklets/src/mock');
  globalThis.requestAnimationFrame = raf;
  return mock;
});

jest.mock('expo-keep-awake', () => ({
  useKeepAwake: jest.fn(),
  activateKeepAwakeAsync: jest.fn(),
  deactivateKeepAwakeAsync: jest.fn(),
}));
