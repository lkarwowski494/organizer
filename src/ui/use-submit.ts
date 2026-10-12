/**
 * Wysyłka formularza do serwera (audyt 3, N-137): jedna naraz. Return w polu i przycisk wołają tę samą funkcję —
 * blokada w ref działa od razu (drugie Return w tej samej chwili, zanim React narysuje „zajęty” przycisk), a stan `busy`
 * to wygląd przycisku. Bez tego „Twoje imię” wysyłało imię dwa razy i cofało o dwa ekrany, a dołączanie wołało serwer
 * drugi raz (przy kodzie dziecka — nieudana próba z limitu).
 */
import { useEffect, useRef, useState } from 'react';

export function useSubmit(run: () => Promise<void>): { busy: boolean; submit: () => void } {
  const running = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => void (mounted.current = false), []);
  const submit = () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    void run().finally(() => {
      running.current = false;
      if (mounted.current) setBusy(false);
    });
  };
  return { busy, submit };
}
