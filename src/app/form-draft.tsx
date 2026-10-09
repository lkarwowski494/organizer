/**
 * Szkic formularza z „Zapisz” (decyzja właściciela 8.10.2026, D179; audyt 2, M-123) — jeden mechanizm dla wszystkich
 * formularzy: nowe zadanie, wydarzenie, rutyna, plan lekcji, nowa lista, nowa grupa. Reguły: domain/drafts.ts.
 *  - Każda zmiana pola od razu trafia do szkicu w lokalnej bazie telefonu (klucz `draft:<konto>:<formularz>`, bez
 *    synchronizacji; osobno dla każdego konta na telefonie), więc szkic przeżywa wyjście gestem, „Wróć” i zamknięcie
 *    aplikacji. Cofnięcie zmiany do wartości z otwarcia usuwa pole ze szkicu.
 *  - Ponowne otwarcie tego samego formularza przywraca szkic (`restore`; formularz otwarty z wpisanym tekstem — np.
 *    „Więcej” przy polu dodawania — startuje z tego tekstu, szkicu nie przywraca i zastępuje go swoim) z napisem
 *    „Przywrócono niezapisane zmiany · Odrzuć” (DraftNote).
 *  - „Zapisz” (`saved`) i „Odrzuć” (`discard`) usuwają szkic.
 * Ekran podaje wartości pól i ich settery — nie musi zmieniać swojego stanu na jeden obiekt.
 */
import { useEffect, useRef, useState } from 'react';

import { changedFields, decodeDraft, encodeDraft } from '../domain/drafts';
import { strings } from '../i18n/strings.pl';
import { announce } from '../ui/a11y';
import { Body, Button } from '../ui/components';
import { useServices } from './context';

type Setters<F> = { [K in keyof F]: (v: F[K]) => void };

export const draftKey = (userId: string, form: string) => `draft:${userId}:${form}`;

export function useFormDraft<F extends Record<string, unknown>>(form: string, values: F, setters: Setters<F>, o: { restore?: boolean } = {}) {
  const { local, userId, nowMs } = useServices();
  const key = draftKey(userId, form);
  // Wartości z chwili otwarcia i szkic do przywrócenia — raz, przy pierwszym rysowaniu.
  const [boot] = useState(() => ({ initial: values, draft: o.restore === false ? null : decodeDraft<F>(local?.load(key) ?? null, Object.keys(values), nowMs()) }));
  const [applied, setApplied] = useState(false);
  const [restored, setRestored] = useState(boot.draft !== null);
  // Przywrócenie w trakcie pierwszego rysowania (stan tego samego ekranu), bez mignięcia pustym formularzem.
  if (!applied) {
    setApplied(true);
    if (boot.draft) for (const k of Object.keys(boot.draft.changes) as (keyof F)[]) setters[k](boot.draft.changes[k] as F[keyof F]);
  }
  const done = useRef(false);
  // Ostatnio zapisane zmiany (JSON) — ten sam szkic nie zapisuje się drugi raz (wiek liczy się od ostatniej zmiany).
  const stored = useRef<string | null>(boot.draft ? JSON.stringify(boot.draft.changes) : null);
  const changes = applied ? JSON.stringify(changedFields(boot.initial, values)) : null;
  useEffect(() => {
    if (changes === null || done.current || changes === stored.current) return;
    stored.current = changes;
    local?.save(key, encodeDraft(JSON.parse(changes) as Partial<F>, nowMs()));
  }, [changes]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    restored,
    /** Po zapisie formularza: szkic znika i już nie powstaje (ekran zaraz się zamknie). */
    saved: () => {
      done.current = true;
      local?.save(key, null);
    },
    /** „Odrzuć”: pola wracają do wartości z otwarcia, szkic znika. */
    discard: () => {
      for (const k of Object.keys(changedFields(boot.initial, values)) as (keyof F)[]) setters[k](boot.initial[k]);
      local?.save(key, null);
      stored.current = '{}';
      setRestored(false);
    },
  };
}

/** Napis nad formularzem po przywróceniu szkicu: „Przywrócono niezapisane zmiany · Odrzuć”. */
export function DraftNote({ draft }: { draft: { restored: boolean; discard: () => void } }) {
  if (!draft.restored) return null;
  return (
    <>
      <Body muted>{strings['draft.restored']}</Body>
      <Button kind="secondary" label={strings['draft.discard']} a11yLabel={strings['draft.discardA11y']} testID="draft-discard" onPress={draft.discard} />
    </>
  );
}

/** Ogłoszenie VoiceOvera po otwarciu ekranu (np. tytuł formularza po przełączeniu „Rodzaj”, M-255); null — nic. */
export function useAnnounce(text: string | null) {
  useEffect(() => {
    announce(text);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
