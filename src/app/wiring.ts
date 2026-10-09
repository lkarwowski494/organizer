/**
 * Prawdziwe zależności korzenia aplikacji (na iPhonie): Supabase z sesją w pęku kluczy, expo-sqlite,
 * Sign in with Apple, linki, kanały Realtime. Ten plik tylko składa moduły — logika i testy są w nich.
 * Wyjątek: build E2E (`appDeps`, D143) — atrapy z src/app/e2e.ts.
 */
import NetInfo from '@react-native-community/netinfo';
import { createClient } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { deleteDatabaseSync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { AppState } from 'react-native';

import { config } from '../config';
import { expoAdapter } from '../data/db/expo-adapter';
import { uuidv7 } from '../domain/ids';
import { emailName, PLACEHOLDER_NAME } from '../domain/views/my-name';
import { chunkedSecureStorage } from '../sync/session-storage';
import { type DetachedClient, type PushTokenMemory, type SignOutJobMemory, supabaseAccount, supabaseTransport, type SupabaseLike } from '../sync/supabase';
import { expoDeviceCalendar } from './device-calendar';
import { e2eDeps } from './e2e';
import { expoDevicePush, showWhileOpen } from './push';
import { expoTravel } from './travel-service';
import type { RootDeps, Session } from './Root';

type User = { id: string; email?: string; user_metadata?: { full_name?: string; display_name?: string }; app_metadata?: { provider?: string; providers?: string[] } };
// D100: bez imienia w koncie (logowanie e-mailem) pytamy o nie; do tego czasu — początek adresu jak dotąd.
const toSession = (u: User | null | undefined): Session | null => {
  if (!u) return null;
  const named = u.user_metadata?.display_name || u.user_metadata?.full_name;
  // D177: konto bez Apple (założone dawniej linkiem z e-maila) — po wylogowaniu w tej wersji już do niego nie wrócisz.
  const apple = (u.app_metadata?.providers ?? [u.app_metadata?.provider]).includes('apple');
  return { userId: u.id, displayName: named || emailName(u.email) || PLACEHOLDER_NAME, needsName: !named, emailName: emailName(u.email), ...(apple ? {} : { emailOnly: true }) };
};

const apple = async (scopes?: 'none') =>
  AppleAuthentication.signInAsync({ requestedScopes: scopes === 'none' ? [] : [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL] });

const newId = () => uuidv7((n) => Crypto.getRandomBytes(n));

/** Pęk kluczy bez przenoszenia do kopii i na nowy telefon (jak sesja). */
const DEVICE_ONLY = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

/** Ostatni zarejestrowany token push (audyt 2, N-11): wylogowanie zdejmuje go także po nieudanej rejestracji przy starcie. */
const PUSH_TOKEN = 'pushToken';
const pushTokenMemory: PushTokenMemory = {
  load: () => SecureStore.getItemAsync(PUSH_TOKEN),
  save: (t) => (t === null ? SecureStore.deleteItemAsync(PUSH_TOKEN) : SecureStore.setItemAsync(PUSH_TOKEN, t)),
};

/**
 * Zaległe wyrejestrowanie tokenu po wylogowaniu bez sieci: token odświeżania starej sesji — w pęku kluczy tylko na tym
 * urządzeniu, jak sama sesja (SecureStore SDK 57: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY).
 */
const SIGNOUT_JOBS = 'signOutJobs';
const KEYCHAIN = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const signOutJobs: SignOutJobMemory = {
  load: () => SecureStore.getItemAsync(SIGNOUT_JOBS, KEYCHAIN),
  save: (v) => (v === null ? SecureStore.deleteItemAsync(SIGNOUT_JOBS, KEYCHAIN) : SecureStore.setItemAsync(SIGNOUT_JOBS, v, KEYCHAIN)),
};

/** Pliki baz kont (D3: osobny plik na konto); otwarta baza musi być zamknięta przed usunięciem (expo-sqlite rzuca DeleteDatabaseException). */
const dbName = (userId: string) => `organizer-${userId}.db`;
const openDbs = new Map<string, SQLiteDatabase>();

/**
 * Zależności tego buildu. Build E2E (D143, EXPO_PUBLIC_E2E=1 tylko w .github/workflows/e2e.yml) dostaje atrapy w pamięci
 * (src/app/e2e.ts); każdy inny — Supabase. Porównanie wprost z `process.env.EXPO_PUBLIC_E2E`: tylko taki zapis Expo
 * podmienia przy budowaniu na stałą (https://docs.expo.dev/guides/environment-variables/), więc bez flagi warunek jest
 * stale fałszywy.
 */
export function appDeps(): RootDeps {
  if (process.env.EXPO_PUBLIC_E2E === '1') {
    return e2eDeps({
      openDb: () => expoAdapter(openDatabaseSync(':memory:')),
      newId,
      isSimulator: async () => (await Application.getIosApplicationReleaseTypeAsync()) === Application.ApplicationReleaseType.SIMULATOR,
    });
  }
  return realDeps();
}

export function realDeps(): RootDeps {
  showWhileOpen();
  // Klient tworzony dopiero tutaj (nie przy imporcie modułu): build E2E nie ma klucza Supabase, a createClient bez klucza rzuca wyjątek.
  const client = createClient(config.SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '', {
    auth: {
      storage: chunkedSecureStorage(SecureStore, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  // Odświeżanie tokenu tylko na pierwszym planie (zalecenie Supabase dla React Native).
  AppState.addEventListener('change', (s) => (s === 'active' ? client.auth.startAutoRefresh() : client.auth.stopAutoRefresh()));
  const sb = client as unknown as SupabaseLike;
  // Stara sesja po wylogowaniu bez sieci: osobny klient bez zapisu sesji i bez odświeżania w tle (nie rusza bieżącego konta).
  const detached = () =>
    createClient(config.SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'organizer-signout' },
    }) as unknown as DetachedClient;
  return {
    account: supabaseAccount(sb, apple, { pushToken: pushTokenMemory, signOutJobs, detached }),
    calendar: expoDeviceCalendar,
    travel: expoTravel,
    push: expoDevicePush,
    prefs: { get: (k) => SecureStore.getItemAsync(`pref.${k}`), set: (k, v) => SecureStore.setItemAsync(`pref.${k}`, v) },
    legacyPrefs: { get: (k) => SecureStore.getItemAsync(k), remove: (k) => SecureStore.deleteItemAsync(k) },
    appearance: { load: () => SecureStore.getItemAsync('appearance'), save: (a) => SecureStore.setItemAsync('appearance', a) },
    transport: supabaseTransport(sb),
    session: {
      current: async () => toSession((await client.auth.getSession()).data.session?.user),
      onChange: (fn) => client.auth.onAuthStateChange((_e, s) => fn(toSession(s?.user))).data.subscription.unsubscribe,
      // Audyt 2, M-9: po 401 z serwera. Nowy token przychodzi przez onAuthStateChange (TOKEN_REFRESHED); nieważny
      // refresh token kończy sesję w auth-js (SIGNED_OUT → ekran logowania, dane konta zostają w jego bazie).
      refresh: async () => {
        const { error } = await client.auth.refreshSession();
        if (error) throw error;
      },
      signOutLocal: async () => {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw error;
      },
    },
    // Audyt 2, M-8: identyfikator instalacji także w pęku kluczy „tylko to urządzenie” — wpis z tym atrybutem „is not
    // migrated to a new device when restoring from a backup” (https://docs.expo.dev/versions/v57.0.0/sdk/securestore/),
    // a baza w Documents do kopii trafia. getItem/setItem — wersje synchroniczne z tej samej strony.
    deviceClientId: {
      load: (userId) => SecureStore.getItem(`clientId.${userId}`, DEVICE_ONLY),
      save: (userId, id) => SecureStore.setItem(`clientId.${userId}`, id, DEVICE_ONLY),
    },
    // Audyt 2, M-10: NetInfo (https://docs.expo.dev/versions/v57.0.0/sdk/netinfo/, addEventListener → state.isConnected).
    // Stan nieznany (null) traktujemy jak sieć — o braku połączenia i tak powie nieudane żądanie (captive portal).
    network: { subscribe: (fn) => NetInfo.addEventListener((state) => fn(state.isConnected !== false)) },
    // Jedno połączenie na plik: odświeżenie w tle (background.ts) i ekrany w tym samym procesie piszą przez nie po kolei.
    openDb: (userId) => {
      const db = openDbs.get(userId) ?? openDatabaseSync(dbName(userId));
      openDbs.set(userId, db);
      return expoAdapter(db);
    },
    // expo-sqlite SDK 57 (https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/): closeSync — „Close the database.”,
    // deleteDatabaseSync(databaseName) — „Delete a database file.”
    removeDb: (userId) => {
      // Audyt 3 (N-77): identyfikator instalacji usuniętego konta nie zostaje w pęku kluczy (pęk kluczy przeżywa nawet
      // usunięcie aplikacji). deleteItemAsync — SDK 57 (https://docs.expo.dev/versions/v57.0.0/sdk/securestore/).
      void SecureStore.deleteItemAsync(`clientId.${userId}`, DEVICE_ONLY).catch(() => {});
      try {
        openDbs.get(userId)?.closeSync();
        openDbs.delete(userId);
        deleteDatabaseSync(dbName(userId));
      } catch {
        // Plik zostaje — dane i tak nie są już dostępne bez konta; następne usunięcie aplikacji go zabierze.
      }
    },
    newId,
    subscribe: (topics, onPoke) => {
      void client.realtime.setAuth();
      const channels = topics.map((topic) =>
        client
          .channel(topic, { config: { private: true } })
          .on('broadcast', { event: 'poke' }, (msg) => onPoke(topic, typeof msg.payload?.v === 'number' ? msg.payload.v : null))
          .subscribe(),
      );
      return () => channels.forEach((ch) => void client.removeChannel(ch));
    },
    links: {
      onUrl: (fn) => Linking.addEventListener('url', (e) => fn(e.url)).remove,
    },
  };
}
