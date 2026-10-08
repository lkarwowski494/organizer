/**
 * Pole tekstowe z zapisem od razu (D130 — jak tytuł zadania): pokazuje dane (także zmianę z drugiego telefonu), dopóki
 * go nie edytuję; zapisuje się po wyjściu z pola, po zatwierdzeniu i przy zamknięciu (ekranu albo panelu), tylko gdy
 * coś zmieniłem. Pusty tekst zostawia stary (jak pusty tytuł zadania). Bez przycisku „Zapisz”. Do rozłożenia w <Field>.
 */
import { useEffect, useRef, useState } from 'react';

type Live = { draft: string | null; current: string; save: (text: string) => void };

function commitOf(l: Live): void {
  const text = l.draft?.trim();
  if (text && text !== l.current) l.save(text);
}

export function useLiveText(current: string, save: (text: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  const latest = useRef<Live>({ draft, current, save });
  useEffect(() => {
    latest.current = { draft, current, save };
  });
  // Zamknięcie ekranu albo panelu: zapis tekstu z pola, z którego nie wyszło się wcześniej.
  useEffect(() => () => commitOf(latest.current), []);
  const commit = () => {
    commitOf({ draft, current, save });
    latest.current = { ...latest.current, draft: null };
    setDraft(null);
  };
  return { value: draft ?? current, onChangeText: setDraft, onBlur: commit, onSubmitEditing: commit };
}
