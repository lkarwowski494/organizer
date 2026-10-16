import { useEffect, useState } from 'react';

import { getEnDictionary, getLanguage, LANGUAGE_PREF_KEY, setEnDictionary, setLanguage, subscribeLanguage, type SupportedLanguage } from './state';
import { strings as stringsEn } from './strings.en';
import { rawStringsPl, strings, type Strings } from './strings.pl';

setEnDictionary(stringsEn as Record<string | symbol, unknown>);

export { getEnDictionary, getLanguage, LANGUAGE_PREF_KEY, rawStringsPl, setLanguage, strings, subscribeLanguage, type Strings, type SupportedLanguage };

export function useLanguage(): { language: SupportedLanguage; setLanguage: (lang: SupportedLanguage) => void } {
  const [lang, setLang] = useState<SupportedLanguage>(getLanguage);

  useEffect(() => {
    return subscribeLanguage(setLang);
  }, []);

  return {
    language: lang,
    setLanguage,
  };
}
