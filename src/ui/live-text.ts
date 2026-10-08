/**
 * Pole tekstowe z zapisem od razu (D130 — jak tytuł zadania) — jeden mechanizm dla tytułu i notatki zadania, nazwy listy,
 * pozycji zakupów, nazwy grupy i imienia osoby (audyt 2: T-22, R-36, M-202; scalenie wersji z paczek list i grup):
 *  - pole pokazuje dane (także zmianę z drugiego telefonu), dopóki go nie edytuję; w trakcie pisania nie skacze pod palcem;
 *  - zapis po wyjściu z pola, po zatwierdzeniu i przy zamknięciu (ekranu albo panelu), tylko gdy coś zmieniłem —
 *    od tej chwili pole znów pokazuje dane;
 *  - niepoprawny tekst nie zapisuje się: pole wraca do zapisanej wartości, a pod nim jest komunikat (do następnej zmiany);
 *    przy zamknięciu ekranu niepoprawny tekst przepada. Domyślnie niepoprawny jest pusty (komunikat `empty`); `validate`
 *    zastępuje tę regułę, `allowEmpty` — pusty jest poprawny (notatka: pusta = bez notatki, `save('')`);
 *  - `drop()` porzuca edycję bez zapisu (np. gdy rzecz właśnie znika: wyjście z grupy, kosz).
 * Bez przycisku „Zapisz”. `field` do rozłożenia w <Field>; `error` — tekst komunikatu albo null.
 * Formularze z „Zapisz” mają szkic na telefonie (app/form-draft.ts) — ta sama rodzina: zmienione pola, nie cały stan.
 */
import { useEffect, useRef, useState } from 'react';

export type LiveOptions = { empty?: string; validate?: (text: string) => string | null; allowEmpty?: boolean };
type Live = { draft: string | null; current: string; save: (text: string) => void; o: LiveOptions };

/** Komunikat dla tekstu ('' = niepoprawny bez komunikatu) albo null (poprawny). */
function problem(text: string, o: LiveOptions): string | null {
  if (o.validate) return o.validate(text);
  return !o.allowEmpty && text.trim() === '' ? (o.empty ?? '') : null;
}

/** Zapis edytowanego tekstu; zwraca komunikat, gdy tekst jest niepoprawny (wtedy nic nie zapisano). */
function commitOf(l: Live): string | null {
  if (l.draft === null) return null;
  const bad = problem(l.draft, l.o);
  if (bad !== null) return bad;
  const text = l.draft.trim();
  if (text !== l.current.trim()) l.save(text);
  return null;
}

export function useLiveText(current: string, save: (text: string) => void, o: LiveOptions = {}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<Live>({ draft, current, save, o });
  useEffect(() => {
    latest.current = { draft, current, save, o };
  });
  // Zamknięcie ekranu albo panelu: zapis tekstu z pola, z którego nie wyszło się wcześniej.
  useEffect(() => () => void commitOf(latest.current), []);
  const end = () => {
    latest.current = { ...latest.current, draft: null };
    setDraft(null);
  };
  const commit = () => {
    setError(commitOf({ draft, current, save, o }) || null);
    end();
  };
  return {
    field: {
      value: draft ?? current,
      onChangeText: (v: string) => (setDraft(v), setError(null)),
      onBlur: commit,
      onSubmitEditing: commit,
    },
    error,
    drop: () => (end(), setError(null)),
  };
}
