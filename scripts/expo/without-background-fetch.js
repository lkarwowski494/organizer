/**
 * D159: aplikacja budzi się w tle tylko na ciche powiadomienia (UIBackgroundModes: remote-notification). Wtyczka
 * expo-task-manager (wymagana przez zadanie cichych powiadomień, expo-notifications registerTaskAsync) dopisuje też
 * „fetch” (Background fetch), którego nie używamy — usuwamy go, żeby deklarować tylko to, co aplikacja robi
 * (App Review Guidelines 2.5.4, przeczytane 8.10.2026: „Multitasking apps may only use background services for their
 * intended purposes: VoIP, audio playback, location, task completion, local notifications, etc.”,
 * https://developer.apple.com/app-store/review/guidelines/#2.5.4).
 * Pierwsza na liście wtyczek w app.json: zmiany Info.plist wykonują się od ostatniej wtyczki do pierwszej, więc ta
 * widzi już „fetch” dopisany przez expo-task-manager (pilnuje test app-json.contract.test.ts).
 */
const { withInfoPlist } = require('expo/config-plugins');

module.exports = function withoutBackgroundFetch(config) {
  return withInfoPlist(config, (c) => {
    const modes = c.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) c.modResults.UIBackgroundModes = modes.filter((m) => m !== 'fetch');
    return c;
  });
};
