/**
 * Szkic formularza z „Zapisz” (decyzja właściciela 8.10.2026, D179; audyt 2, M-123) — jeden mechanizm dla wszystkich
 * formularzy: nowe zadanie, wydarzenie, rutyna, plan lekcji, nowa lista, nowa grupa. Reguły: domain/drafts.ts.
 *  - Każda zmiana pola od razu trafia do szkicu w lokalnej bazie telefonu (klucz `draft:<konto>:<formularz>`, bez
 *    synchronizacji; osobno dla każdego konta na telefonie), więc szkic przeżywa wyjście gestem, „Wróć” i zamknięcie
 *    aplikacji. Cofnięcie zmiany do wartości z otwarcia usuwa pole ze szkicu.
 *  - Ponowne otwarcie tego samego formularza przywraca szkic (`restore`; formularz otwarty z wpisanym tekstem — np.
 *    „Więcej” przy polu dodawania — startuje z tego tekstu, szkicu nie przywraca, a zastępuje go swoim przy pierwszej
 *    zmianie) z napisem
 *    „Przywrócono niezapisane zmiany · Odrzuć” (DraftNote).
 *  - Audyt 3 (N-138): pola przeniesione z innego formularza (przełącznik „Rodzaj”) liczą się jak wpisane — `initial`
 *    to pusty formularz, więc „Wróć” ich nie gubi (szkic powstaje od razu i zastępuje stary szkic tego formularza).
 *  - Audyt 3 (N-32, N-144, N-146): `sanitize` poprawia przywracane pola, których już nie ma (grupa, osoba, miniony
 *    dzień; parametry otwarcia mają pierwszeństwo) — napisy o tym pokazuje DraftNote.
 *  - Audyt 3 (N-31): `stamp` — znacznik danych, na których szkic powstał; przywrócony szkic oddaje swój (`stamp`).
 *  - „Zapisz” (`saved`) i „Odrzuć” (`discard`) usuwają szkic.
 * Ekran podaje wartości pól i ich settery — nie musi zmieniać swojego stanu na jeden obiekt.
 */
import { useEffect, useRef, useState } from 'react';

import { changedFields, decodeDraft, encodeDraft } from '../domain/drafts';
import type { DraftFix, DraftNotice } from '../domain/views/form-choices';
import { strings } from '../i18n/strings.pl';
import { announce } from '../ui/a11y';
import { Body, Button } from '../ui/components';
import { useServices } from './context';

type Setters<F> = { [K in keyof F]: (v: F[K]) => void };
export type DraftOptions<F> = { restore?: boolean; initial?: F; sanitize?: (changes: Partial<F>, initial: F) => DraftFix<F>; stamp?: string };

export const draftKey = (userId: string, form: string) => `draft:${userId}:${form}`;

export function useFormDraft<F extends Record<string, unknown>>(form: string, values: F, setters: Setters<F>, o: DraftOptions<F> = {}) {
  const { local, userId, nowMs } = useServices();
  const key = draftKey(userId, form);
  // Wartości z chwili otwarcia i szkic do przywrócenia — raz, przy pierwszym rysowaniu.
  const [boot] = useState(() => {
    const initial = o.initial ?? values;
    const raw = o.restore === false ? null : decodeDraft<F>(local?.load(key) ?? null, Object.keys(values), nowMs());
    const fix = raw && o.sanitize ? o.sanitize(raw.changes, initial) : raw ? { changes: raw.changes, notices: [] } : null;
    const draft = raw && fix && (Object.keys(fix.changes).length || fix.notices.length) ? { ...raw, changes: fix.changes } : null;
    return { initial, draft, raw: raw ? JSON.stringify(raw.changes) : null, notices: fix?.notices ?? [] };
  });
  const [applied, setApplied] = useState(false);
  const [restored, setRestored] = useState(boot.draft !== null);
  const [notices, setNotices] = useState<readonly DraftNotice[]>(boot.notices);
  // Przywrócenie w trakcie pierwszego rysowania (stan tego samego ekranu), bez mignięcia pustym formularzem.
  if (!applied) {
    setApplied(true);
    if (boot.draft) for (const k of Object.keys(boot.draft.changes) as (keyof F)[]) setters[k](boot.draft.changes[k] as F[keyof F]);
  }
  const done = useRef(false);
  // Znacznik zapisywany ze szkicem: przywrócony szkic zostaje przy swoim (brak — szkic starszej wersji: '').
  const [stamp, setStamp] = useState(boot.draft ? (boot.draft.stamp ?? '') : o.stamp);
  // Ostatnio zapisane zmiany (JSON) — ten sam szkic nie zapisuje się drugi raz (wiek liczy się od ostatniej zmiany).
  // Bez przywracania (formularz z wpisanym tekstem) stary szkic zostaje do pierwszej zmiany (audyt 3, N-138).
  const stored = useRef<string | null>(boot.raw ?? (o.restore === false ? '{}' : null));
  const changes = applied ? JSON.stringify(changedFields(boot.initial, values)) : null;
  useEffect(() => {
    if (changes === null || done.current || changes === stored.current) return;
    stored.current = changes;
    local?.save(key, encodeDraft(JSON.parse(changes) as Partial<F>, nowMs(), stamp));
  }, [changes]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    restored,
    notices,
    /** Znacznik danych, na których powstał przywrócony szkic (albo podany w `stamp`). */
    stamp,
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
      setStamp(o.stamp);
      setRestored(false);
      setNotices([]);
    },
  };
}

/** Napis przy przywróconym wyborze, którego już nie ma (N-32, N-144). */
export function noticeText(n: DraftNotice): string {
  if (n.kind === 'group') return strings['draft.groupGone'](n.name);
  if (n.kind === 'people') return strings['draft.peopleGone'](n.names);
  return strings['draft.dateGone'];
}

/** Napis nad formularzem po przywróceniu szkicu: „Przywrócono niezapisane zmiany · Odrzuć” i poprawione wybory. */
export function DraftNote({ draft }: { draft: { restored: boolean; notices: readonly DraftNotice[]; discard: () => void } }) {
  if (!draft.restored) return null;
  return (
    <>
      <Body muted>{strings['draft.restored']}</Body>
      {draft.notices.map((n, i) => (
        <Body key={i} testID="draft-notice">
          {noticeText(n)}
        </Body>
      ))}
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
