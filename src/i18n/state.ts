export type SupportedLanguage = 'pl' | 'en';
export const LANGUAGE_PREF_KEY = 'app_language';

let currentLanguage: SupportedLanguage = 'pl';
let enDictionary: Record<string | symbol, unknown> | null = null;
const listeners = new Set<(lang: SupportedLanguage) => void>();

export function getLanguage(): SupportedLanguage {
  return currentLanguage;
}

export function setLanguage(lang: SupportedLanguage): void {
  if (currentLanguage === lang) return;
  currentLanguage = lang;
  for (const listener of listeners) {
    try {
      listener(lang);
    } catch {
      // ignore
    }
  }
}

export function setEnDictionary(dict: Record<string | symbol, unknown>): void {
  enDictionary = dict;
}

export function getEnDictionary(): Record<string | symbol, unknown> | null {
  return enDictionary;
}

export function subscribeLanguage(listener: (lang: SupportedLanguage) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
