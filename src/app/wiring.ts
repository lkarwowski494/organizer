/**
 * Prawdziwe zależności korzenia aplikacji (na iPhonie): Supabase z sesją w pęku kluczy, expo-sqlite,
 * Sign in with Apple, linki, kanały Realtime. Ten plik tylko składa moduły — logika i testy są w nich.
 * Wyjątek: build E2E (`appDeps`, D143) — atrapy z src/app/e2e.ts.
 */
import { createClient } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { openDatabaseSync } from 'expo-sqlite';
import { AppState } from 'react-native';

import { config } from '../config';
import { expoAdapter } from '../data/db/expo-adapter';
import { uuidv7 } from '../domain/ids';
import { emailName, PLACEHOLDER_NAME } from '../domain/views/my-name';
import { chunkedSecureStorage } from '../sync/session-storage';
import { supabaseAccount, supabaseTransport, type SupabaseLike } from '../sync/supabase';
import { expoDeviceCalendar } from './device-calendar';
import { e2eDeps } from './e2e';
import { expoDevicePush } from './push';
import { expoTravel } from './travel-service';
import type { RootDeps, Session } from './Root';

type User = { id: string; email?: string; user_metadata?: { full_name?: string; display_name?: string } };
// D100: bez imienia w koncie (logowanie e-mailem) pytamy o nie; do tego czasu — początek adresu jak dotąd.
const toSession = (u: User | null | undefined): Session | null => {
  if (!u) return null;
  const named = u.user_metadata?.display_name || u.user_metadata?.full_name;
  return { userId: u.id, displayName: named || emailName(u.email) || PLACEHOLDER_NAME, needsName: !named, emailName: emailName(u.email) };
};

const apple = async (scopes?: 'none') =>
  AppleAuthentication.signInAsync({ requestedScopes: scopes === 'none' ? [] : [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL] });

const newId = () => uuidv7((n) => Crypto.getRandomBytes(n));

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
  return {
    account: supabaseAccount(sb, apple),
    calendar: expoDeviceCalendar,
    travel: expoTravel,
    push: expoDevicePush,
    prefs: { get: (k) => SecureStore.getItemAsync(`pref.${k}`), set: (k, v) => SecureStore.setItemAsync(`pref.${k}`, v) },
    appearance: { load: () => SecureStore.getItemAsync('appearance'), save: (a) => SecureStore.setItemAsync('appearance', a) },
    transport: supabaseTransport(sb),
    session: {
      current: async () => toSession((await client.auth.getSession()).data.session?.user),
      onChange: (fn) => client.auth.onAuthStateChange((_e, s) => fn(toSession(s?.user))).data.subscription.unsubscribe,
      setFromLink: async (t) => {
        const { error } = await client.auth.setSession(t);
        if (error) throw error;
      },
    },
    openDb: (userId) => expoAdapter(openDatabaseSync(`organizer-${userId}.db`)),
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
      initial: () => Linking.getInitialURL(),
      onUrl: (fn) => Linking.addEventListener('url', (e) => fn(e.url)).remove,
    },
  };
}
