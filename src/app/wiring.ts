/**
 * Prawdziwe zależności korzenia aplikacji (na iPhonie): Supabase z sesją w pęku kluczy, expo-sqlite,
 * Sign in with Apple, linki, kanały Realtime. Ten plik tylko składa moduły — logika i testy są w nich.
 */
import { createClient } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { openDatabaseSync } from 'expo-sqlite';
import { AppState } from 'react-native';

import { config } from '../config';
import { expoAdapter } from '../data/db/expo-adapter';
import { uuidv7 } from '../domain/ids';
import { chunkedSecureStorage } from '../sync/session-storage';
import { supabaseAccount, supabaseTransport, type SupabaseLike } from '../sync/supabase';
import { expoDeviceCalendar } from './device-calendar';
import type { RootDeps, Session } from './Root';

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

type User = { id: string; email?: string; user_metadata?: { full_name?: string; display_name?: string } };
const toSession = (u: User | null | undefined): Session | null =>
  u ? { userId: u.id, displayName: u.user_metadata?.display_name || u.user_metadata?.full_name || u.email?.split('@')[0] || 'Ja' } : null;

const apple = async () =>
  AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL] });

export function realDeps(): RootDeps {
  const sb = client as unknown as SupabaseLike;
  return {
    account: supabaseAccount(sb, apple),
    calendar: expoDeviceCalendar,
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
    newId: () => uuidv7((n) => Crypto.getRandomBytes(n)),
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
