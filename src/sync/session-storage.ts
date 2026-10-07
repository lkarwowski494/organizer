/**
 * Magazyn sesji Supabase (tokeny dostępu i odświeżania) w pęku kluczy iOS przez expo-secure-store.
 * Dokumentacja SDK 57 (https://docs.expo.dev/versions/v57.0.0/sdk/securestore/): „Historically, some iOS
 * releases refused values above roughly 2048 bytes. Expo does not enforce a limit” — dlatego wartość
 * dzielimy na kawałki po CHUNK znaków (tokeny są ASCII, więc znak = bajt).
 * Dostępność: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY — dostępne w tle po pierwszym odblokowaniu, nie
 * przechodzi do kopii zapasowej na inny telefon.
 */
export type SecureStoreLike = {
  getItemAsync(key: string, options?: object): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: object): Promise<void>;
  deleteItemAsync(key: string, options?: object): Promise<void>;
};

export const CHUNK = 1800;

/** Klucze SecureStore: litery, cyfry, „.”, „-”, „_”. Klucz Supabase (sb-<ref>-auth-token) to spełnia. */
const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

export function chunkedSecureStorage(store: SecureStoreLike, options: object) {
  const countKey = (k: string) => `${safe(k)}.n`;
  const partKey = (k: string, i: number) => `${safe(k)}.${i}`;
  const removeItem = async (key: string) => {
    const n = Number((await store.getItemAsync(countKey(key), options)) ?? 0);
    for (let i = 0; i < n; i++) await store.deleteItemAsync(partKey(key, i), options);
    await store.deleteItemAsync(countKey(key), options);
  };
  return {
    async getItem(key: string): Promise<string | null> {
      const n = await store.getItemAsync(countKey(key), options);
      if (n === null) return null;
      const parts: string[] = [];
      for (let i = 0; i < Number(n); i++) {
        const p = await store.getItemAsync(partKey(key, i), options);
        if (p === null) return null; // niepełny zapis (przerwany) — jak brak sesji, użytkownik zaloguje się ponownie
        parts.push(p);
      }
      return parts.join('');
    },
    async setItem(key: string, value: string): Promise<void> {
      await removeItem(key);
      const n = Math.max(1, Math.ceil(value.length / CHUNK));
      for (let i = 0; i < n; i++) await store.setItemAsync(partKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK), options);
      await store.setItemAsync(countKey(key), String(n), options);
    },
    removeItem,
  };
}
